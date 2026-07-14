use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    env,
    ffi::{c_void, OsStr},
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const APP_SERVER_TIMEOUT: Duration = Duration::from_secs(15);
const LOGIN_TIMEOUT: Duration = Duration::from_secs(600);
const ACTIVE_ROLLOUT_FRESHNESS: Duration = Duration::from_secs(300);
const COMPLETED_ROLLOUT_FRESHNESS: Duration = Duration::from_secs(24 * 60 * 60);
const COMPLETED_ROLLOUT_LIMIT: usize = 5;
const ROLLOUT_TAIL_BYTES: u64 = 256 * 1024;
const LOCAL_USAGE_MAX_AGE: Duration = Duration::from_secs(30 * 24 * 60 * 60);
const LOCAL_USAGE_CACHE_TTL: Duration = Duration::from_secs(5 * 60);
const LOCAL_USAGE_FILE_LIMIT: usize = 100;
const ACCOUNT_USAGE_CACHE_TTL: Duration = Duration::from_secs(60);
const CHATGPT_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CHATGPT_PROFILE_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/profiles/me";
const OPENAI_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const OPENAI_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const COMPACT_WIDTH: f64 = 504.0;
const COMPACT_HEIGHT: f64 = 54.0;
const COMPACT_POPOVER_MAX_HEIGHT: f64 = 376.0;
const MAIN_WIDTH: f64 = 1280.0;
const MAIN_HEIGHT: f64 = 720.0;
const MAIN_MIN_WIDTH: f64 = 960.0;
const MAIN_MIN_HEIGHT: f64 = 650.0;
const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;
const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
const DWMWCP_ROUND: i32 = 2;

#[repr(C)]
struct DataBlob {
    len: u32,
    data: *mut u8,
}

#[link(name = "Crypt32")]
extern "system" {
    fn CryptProtectData(
        input: *mut DataBlob,
        description: *const u16,
        entropy: *mut DataBlob,
        reserved: *mut c_void,
        prompt: *mut c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
    fn CryptUnprotectData(
        input: *mut DataBlob,
        description: *mut *mut u16,
        entropy: *mut DataBlob,
        reserved: *mut c_void,
        prompt: *mut c_void,
        flags: u32,
        output: *mut DataBlob,
    ) -> i32;
}

#[link(name = "Kernel32")]
extern "system" {
    fn LocalFree(memory: *mut c_void) -> *mut c_void;
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        window: *mut c_void,
        attribute: u32,
        value: *const c_void,
        value_size: u32,
    ) -> i32;
}

#[link(name = "Shell32")]
extern "system" {
    fn ShellExecuteW(
        window: *mut c_void,
        operation: *const u16,
        file: *const u16,
        parameters: *const u16,
        directory: *const u16,
        show_command: i32,
    ) -> isize;
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProcessInfo {
    running: bool,
    count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawCodexSnapshot {
    responses: HashMap<String, Value>,
    process: ProcessInfo,
    accounts: Vec<AccountInfo>,
    active_account_id: Option<String>,
    active_account_name: Option<String>,
    local_usage: LocalUsageSummary,
    rollout_token_counters: Vec<RolloutTokenCounter>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RawCodexThreadSnapshot {
    response: Value,
    process: ProcessInfo,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RolloutTokenCounter {
    id: String,
    total_tokens: u64,
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalUsageSummary {
    total_tokens: u64,
    input_tokens: u64,
    cached_input_tokens: u64,
    output_tokens: u64,
    models: Vec<LocalModelUsage>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelUsage {
    name: String,
    tokens: u64,
}

struct CachedLocalUsage {
    refreshed_at: Instant,
    summary: LocalUsageSummary,
}

static LOCAL_USAGE_CACHE: OnceLock<Mutex<Option<CachedLocalUsage>>> = OnceLock::new();

#[derive(Clone, Default)]
struct AccountUsageSnapshot {
    quota_remaining_percent: Option<f64>,
    reset_at: Option<i64>,
    plan: Option<String>,
    daily_usage: Vec<AccountDailyUsage>,
    stats_as_of: Option<String>,
    stats_generated_at: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountDailyUsage {
    date: String,
    tokens: u64,
}

struct CachedAccountUsage {
    refreshed_at: Instant,
    account_ids: Vec<String>,
    usage: HashMap<String, AccountUsageSnapshot>,
}

static ACCOUNT_USAGE_CACHE: OnceLock<Mutex<Option<CachedAccountUsage>>> = OnceLock::new();

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredAccount {
    id: String,
    #[serde(default)]
    account_id: Option<String>,
    #[serde(default)]
    explicitly_added: bool,
    name: String,
    email: Option<String>,
    plan: Option<String>,
    auth_encrypted: String,
}

#[derive(Clone, Copy)]
struct WindowGeometry {
    size: PhysicalSize<u32>,
    position: PhysicalPosition<i32>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct StoredWindowGeometry {
    width: u32,
    height: u32,
    x: i32,
    y: i32,
}

impl From<WindowGeometry> for StoredWindowGeometry {
    fn from(geometry: WindowGeometry) -> Self {
        Self {
            width: geometry.size.width,
            height: geometry.size.height,
            x: geometry.position.x,
            y: geometry.position.y,
        }
    }
}

impl From<StoredWindowGeometry> for WindowGeometry {
    fn from(geometry: StoredWindowGeometry) -> Self {
        Self {
            size: PhysicalSize::new(geometry.width, geometry.height),
            position: PhysicalPosition::new(geometry.x, geometry.y),
        }
    }
}

#[derive(Default)]
struct MainWindowGeometry(Mutex<Option<WindowGeometry>>);

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountStore {
    accounts: Vec<StoredAccount>,
    active_account_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountInfo {
    id: String,
    name: String,
    email: Option<String>,
    plan: Option<String>,
    quota_remaining_percent: Option<f64>,
    reset_at: Option<i64>,
    daily_usage: Vec<AccountDailyUsage>,
    stats_as_of: Option<String>,
    stats_generated_at: Option<String>,
}

impl From<&StoredAccount> for AccountInfo {
    fn from(account: &StoredAccount) -> Self {
        Self {
            id: account.id.clone(),
            name: account.name.clone(),
            email: account.email.clone(),
            plan: account.plan.clone(),
            quota_remaining_percent: None,
            reset_at: None,
            daily_usage: Vec::new(),
            stats_as_of: None,
            stats_generated_at: None,
        }
    }
}

fn hidden_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

fn enable_native_rounded_corners(window: &WebviewWindow) {
    let Ok(handle) = window.hwnd() else {
        return;
    };
    let preference = DWMWCP_ROUND;
    unsafe {
        let _ = DwmSetWindowAttribute(
            handle.0,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            (&preference as *const i32).cast(),
            std::mem::size_of_val(&preference) as u32,
        );
    }
}

fn codex_cli_path() -> PathBuf {
    if let Some(app_data) = env::var_os("APPDATA") {
        let npm_native = PathBuf::from(app_data)
            .join("npm")
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("node_modules")
            .join("@openai")
            .join("codex-win32-x64")
            .join("vendor")
            .join("x86_64-pc-windows-msvc")
            .join("bin")
            .join("codex.exe");
        if npm_native.is_file() {
            return npm_native;
        }
    }

    let discovered = hidden_command("where.exe")
        .arg("codex.exe")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty() && !line.contains("WindowsApps"))
                .map(PathBuf::from)
        });

    discovered.unwrap_or_else(|| PathBuf::from("codex.exe"))
}

fn account_store_path() -> Result<PathBuf, String> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Codex Deck").join("accounts.json"))
        .ok_or("APPDATA is unavailable".to_string())
}

fn window_geometry_path() -> Result<PathBuf, String> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("Codex Deck").join("window-state.json"))
        .ok_or("APPDATA is unavailable".to_string())
}

fn valid_stored_window_geometry(geometry: StoredWindowGeometry) -> bool {
    geometry.width >= MAIN_MIN_WIDTH as u32
        && geometry.height >= MAIN_MIN_HEIGHT as u32
        && geometry.width <= 16_384
        && geometry.height <= 16_384
}

fn load_window_geometry() -> Result<Option<WindowGeometry>, String> {
    let path = window_geometry_path()?;
    if !path.is_file() {
        return Ok(None);
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let stored = serde_json::from_str::<StoredWindowGeometry>(&content)
        .map_err(|error| error.to_string())?;
    Ok(valid_stored_window_geometry(stored).then(|| stored.into()))
}

fn save_window_geometry(geometry: WindowGeometry) -> Result<(), String> {
    let path = window_geometry_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(&StoredWindowGeometry::from(geometry))
        .map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

fn codex_home_path() -> Result<PathBuf, String> {
    if let Some(codex_home) = env::var_os("CODEX_HOME") {
        return Ok(PathBuf::from(codex_home));
    }
    env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|path| path.join(".codex"))
        .ok_or("USERPROFILE is unavailable".to_string())
}

fn codex_auth_path() -> Result<PathBuf, String> {
    codex_home_path().map(|path| path.join("auth.json"))
}

fn decode_base64url(input: &str) -> Option<Vec<u8>> {
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0_u32;
    let mut bits = 0_u8;
    for byte in input.bytes() {
        if byte == b'=' {
            break;
        }
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
            if bits == 0 {
                buffer = 0;
            } else {
                buffer &= (1_u32 << bits) - 1;
            }
        }
    }
    Some(output)
}

fn auth_id_token_claims(auth_content: &str) -> Option<Value> {
    let auth = serde_json::from_str::<Value>(auth_content).ok()?;
    let id_token = auth.get("tokens")?.get("id_token")?.as_str()?;
    let payload = id_token.split('.').nth(1)?;
    serde_json::from_slice::<Value>(&decode_base64url(payload)?).ok()
}

fn auth_display_name(auth_content: &str) -> Option<String> {
    auth_id_token_claims(auth_content)?
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string)
}

fn auth_account_id(auth_content: &str) -> Option<String> {
    let auth = serde_json::from_str::<Value>(auth_content).ok()?;
    auth.get("tokens")
        .and_then(|tokens| tokens.get("account_id"))
        .or_else(|| auth.get("account_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|account_id| !account_id.is_empty())
        .map(str::to_string)
        .or_else(|| {
            auth_id_token_claims(auth_content)?
                .get("https://api.openai.com/auth")?
                .get("chatgpt_account_id")?
                .as_str()
                .map(str::to_string)
        })
}

fn auth_email(auth_content: &str) -> Option<String> {
    auth_id_token_claims(auth_content)?
        .get("email")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn auth_plan(auth_content: &str) -> Option<String> {
    auth_id_token_claims(auth_content)?
        .get("https://api.openai.com/auth")?
        .get("chatgpt_plan_type")?
        .as_str()
        .map(str::to_string)
}

fn auth_token(auth_content: &str, key: &str) -> Option<String> {
    serde_json::from_str::<Value>(auth_content)
        .ok()?
        .get("tokens")?
        .get(key)?
        .as_str()
        .map(str::to_string)
}

fn parse_account_usage(payload: &Value) -> AccountUsageSnapshot {
    let rate_limit = payload.get("rate_limit");
    let window = rate_limit
        .and_then(|rate_limit| rate_limit.get("secondary_window"))
        .filter(|window| !window.is_null())
        .or_else(|| rate_limit.and_then(|rate_limit| rate_limit.get("primary_window")));
    let used_percent = window
        .and_then(|window| window.get("used_percent"))
        .and_then(Value::as_f64);
    AccountUsageSnapshot {
        quota_remaining_percent: used_percent.map(|used| (100.0 - used).clamp(0.0, 100.0)),
        reset_at: window
            .and_then(|window| window.get("reset_at"))
            .and_then(Value::as_i64),
        plan: payload
            .get("plan_type")
            .and_then(Value::as_str)
            .map(str::to_string),
        daily_usage: Vec::new(),
        stats_as_of: None,
        stats_generated_at: None,
    }
}

fn parse_profile_daily_usage(payload: &Value) -> Vec<AccountDailyUsage> {
    payload
        .get("stats")
        .and_then(|stats| stats.get("daily_usage_buckets"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|bucket| {
            let date = bucket.get("start_date")?.as_str()?.to_string();
            let tokens = bucket.get("tokens")?.as_i64()?.max(0) as u64;
            Some(AccountDailyUsage { date, tokens })
        })
        .collect()
}

fn apply_refreshed_tokens(auth_content: &str, response: &Value) -> Result<String, String> {
    let mut auth =
        serde_json::from_str::<Value>(auth_content).map_err(|error| error.to_string())?;
    let tokens = auth
        .get_mut("tokens")
        .and_then(Value::as_object_mut)
        .ok_or("Stored ChatGPT credentials have no tokens".to_string())?;
    let access_token = response
        .get("access_token")
        .and_then(Value::as_str)
        .ok_or("Token refresh returned no access token".to_string())?;
    tokens.insert("access_token".to_string(), json!(access_token));
    for key in ["id_token", "refresh_token"] {
        if let Some(value) = response.get(key).and_then(Value::as_str) {
            tokens.insert(key.to_string(), json!(value));
        }
    }
    serde_json::to_string(&auth).map_err(|error| error.to_string())
}

async fn refresh_auth_tokens(
    client: &reqwest::Client,
    auth_content: &str,
) -> Result<String, String> {
    let refresh_token = auth_token(auth_content, "refresh_token")
        .ok_or("Stored ChatGPT credentials have no refresh token".to_string())?;
    let response = client
        .post(OPENAI_TOKEN_URL)
        .form(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token.as_str()),
            ("client_id", OPENAI_CLIENT_ID),
        ])
        .send()
        .await
        .map_err(|error| format!("Token refresh request failed: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Token refresh failed with {}", response.status()));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Token refresh response was invalid: {error}"))?;
    apply_refreshed_tokens(auth_content, &payload)
}

async fn send_account_usage_request(
    client: &reqwest::Client,
    auth_content: &str,
) -> Result<reqwest::Response, String> {
    let access_token = auth_token(auth_content, "access_token")
        .ok_or("Stored ChatGPT credentials have no access token".to_string())?;
    let mut request = client
        .get(CHATGPT_USAGE_URL)
        .bearer_auth(access_token)
        .header("user-agent", "codex-cli/1.0.0");
    if let Some(account_id) = auth_account_id(auth_content) {
        request = request.header("chatgpt-account-id", account_id);
    }
    request
        .send()
        .await
        .map_err(|error| format!("Usage request failed: {error}"))
}

async fn send_profile_usage_request(
    client: &reqwest::Client,
    auth_content: &str,
) -> Result<reqwest::Response, String> {
    let access_token = auth_token(auth_content, "access_token")
        .ok_or("Stored ChatGPT credentials have no access token".to_string())?;
    let mut request = client
        .get(CHATGPT_PROFILE_USAGE_URL)
        .bearer_auth(access_token)
        .header("user-agent", "codex-cli/1.0.0");
    if let Some(account_id) = auth_account_id(auth_content) {
        request = request.header("chatgpt-account-id", account_id);
    }
    request
        .send()
        .await
        .map_err(|error| format!("Profile usage request failed: {error}"))
}

async fn fetch_account_usage(
    client: reqwest::Client,
    auth_content: String,
) -> Result<(AccountUsageSnapshot, Option<String>), String> {
    let original_auth = auth_content.clone();
    let mut current_auth = auth_content;
    let mut response = send_account_usage_request(&client, &current_auth).await?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        current_auth = refresh_auth_tokens(&client, &current_auth).await?;
        response = send_account_usage_request(&client, &current_auth).await?;
    }
    if !response.status().is_success() {
        return Err(format!("Usage request failed with {}", response.status()));
    }
    let payload = response
        .json::<Value>()
        .await
        .map_err(|error| format!("Usage response was invalid: {error}"))?;
    let mut usage = parse_account_usage(&payload);
    if let Ok(mut profile_response) = send_profile_usage_request(&client, &current_auth).await {
        if profile_response.status() == reqwest::StatusCode::UNAUTHORIZED
            && current_auth == original_auth
        {
            if let Ok(refreshed) = refresh_auth_tokens(&client, &current_auth).await {
                current_auth = refreshed;
                if let Ok(response) = send_profile_usage_request(&client, &current_auth).await {
                    profile_response = response;
                }
            }
        }
        if profile_response.status().is_success() {
            if let Ok(profile) = profile_response.json::<Value>().await {
                usage.daily_usage = parse_profile_daily_usage(&profile);
                usage.stats_as_of = profile
                    .get("metadata")
                    .and_then(|metadata| metadata.get("stats_as_of"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
                usage.stats_generated_at = profile
                    .get("metadata")
                    .and_then(|metadata| metadata.get("generated_at"))
                    .and_then(Value::as_str)
                    .map(str::to_string);
            }
        }
    }
    let refreshed_auth = (current_auth != original_auth).then_some(current_auth);
    Ok((usage, refreshed_auth))
}

fn auth_display_name_from_path(auth_path: &Path) -> Option<String> {
    fs::read_to_string(auth_path)
        .ok()
        .and_then(|content| auth_display_name(&content))
}

fn should_activate_added_account(current_auth_exists: bool, codex_running: bool) -> bool {
    !current_auth_exists && !codex_running
}

fn dpapi_transform(input: &[u8], protect: bool) -> Result<Vec<u8>, String> {
    let mut input_blob = DataBlob {
        len: input
            .len()
            .try_into()
            .map_err(|_| "Secret is too large".to_string())?,
        data: input.as_ptr() as *mut u8,
    };
    let mut output_blob = DataBlob {
        len: 0,
        data: std::ptr::null_mut(),
    };

    let success = unsafe {
        if protect {
            CryptProtectData(
                &mut input_blob,
                std::ptr::null(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        } else {
            CryptUnprotectData(
                &mut input_blob,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                CRYPTPROTECT_UI_FORBIDDEN,
                &mut output_blob,
            )
        }
    };

    if success == 0 {
        return Err(std::io::Error::last_os_error().to_string());
    }

    let output = unsafe {
        let bytes = std::slice::from_raw_parts(output_blob.data, output_blob.len as usize).to_vec();
        let _ = LocalFree(output_blob.data.cast());
        bytes
    };
    Ok(output)
}

fn protect_secret(plain_text: &str) -> Result<String, String> {
    let encrypted = dpapi_transform(plain_text.as_bytes(), true)?;
    Ok(encrypted.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn unprotect_secret(cipher_text: &str) -> Result<String, String> {
    if cipher_text.len() % 2 != 0 {
        return Err("Stored credential is invalid".to_string());
    }
    let encrypted = (0..cipher_text.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&cipher_text[index..index + 2], 16)
                .map_err(|_| "Stored credential is invalid".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let plain = dpapi_transform(&encrypted, false)?;
    String::from_utf8(plain).map_err(|_| "Stored credential is invalid".to_string())
}

fn load_account_store() -> Result<AccountStore, String> {
    let path = account_store_path()?;
    if !path.is_file() {
        return Ok(AccountStore::default());
    }
    let content = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn save_account_store(store: &AccountStore) -> Result<(), String> {
    let path = account_store_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs::write(path, content).map_err(|error| error.to_string())
}

async fn managed_account_usage() -> HashMap<String, AccountUsageSnapshot> {
    let managed_accounts = load_account_store()
        .map(|store| {
            store
                .accounts
                .into_iter()
                .filter(|account| account.explicitly_added)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let account_ids = managed_accounts
        .iter()
        .map(|account| account.id.clone())
        .collect::<Vec<_>>();
    let cache = ACCOUNT_USAGE_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.account_ids == account_ids
                && cached.refreshed_at.elapsed() < ACCOUNT_USAGE_CACHE_TTL
            {
                return cached.usage.clone();
            }
        }
    }

    let Ok(client) = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
    else {
        return HashMap::new();
    };
    let mut tasks = Vec::new();
    for account in managed_accounts {
        let Ok(auth_content) = unprotect_secret(&account.auth_encrypted) else {
            continue;
        };
        let task_client = client.clone();
        let account_id = account.id;
        let task = tauri::async_runtime::spawn(async move {
            fetch_account_usage(task_client, auth_content).await
        });
        tasks.push((account_id, task));
    }

    let mut usage = HashMap::new();
    let mut refreshed_credentials = Vec::new();
    for (account_id, task) in tasks {
        if let Ok(Ok((account_usage, refreshed_auth))) = task.await {
            usage.insert(account_id.clone(), account_usage);
            if let Some(refreshed_auth) = refreshed_auth {
                refreshed_credentials.push((account_id, refreshed_auth));
            }
        }
    }

    if !refreshed_credentials.is_empty() {
        if let Ok(mut store) = load_account_store() {
            for (account_id, refreshed_auth) in &refreshed_credentials {
                if let Some(account) = store
                    .accounts
                    .iter_mut()
                    .find(|account| account.id == *account_id)
                {
                    if let Ok(encrypted) = protect_secret(refreshed_auth) {
                        account.auth_encrypted = encrypted;
                    }
                }
            }
            let _ = save_account_store(&store);
        }
        if let Ok(auth_path) = codex_auth_path() {
            if let Ok(current_auth) = fs::read_to_string(&auth_path) {
                let current_id = auth_account_id(&current_auth);
                if let Some((_, refreshed_auth)) = refreshed_credentials
                    .iter()
                    .find(|(_, auth)| auth_account_id(auth) == current_id)
                {
                    let _ = fs::write(auth_path, refreshed_auth);
                }
            }
        }
    }

    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CachedAccountUsage {
            refreshed_at: Instant::now(),
            account_ids,
            usage: usage.clone(),
        });
    }
    usage
}

fn account_metadata(responses: &HashMap<String, Value>) -> (Option<String>, Option<String>) {
    let email = responses
        .get("3")
        .and_then(|response| response.get("account"))
        .and_then(|account| account.get("email"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let rate_limits = responses.get("4");
    let plan = rate_limits
        .and_then(|response| response.get("rateLimitsByLimitId"))
        .and_then(|limits| limits.get("codex"))
        .or_else(|| rate_limits.and_then(|response| response.get("rateLimits")))
        .and_then(|limits| limits.get("planType"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (email, plan)
}

fn save_account_from_auth(
    alias: String,
    responses: &HashMap<String, Value>,
    auth_path: &Path,
    make_active: bool,
) -> Result<AccountInfo, String> {
    let auth_content = fs::read_to_string(auth_path)
        .map_err(|error| format!("Could not read {}: {error}", auth_path.display()))?;
    serde_json::from_str::<Value>(&auth_content).map_err(|error| error.to_string())?;
    let account_id = auth_account_id(&auth_content);
    let auth_encrypted = protect_secret(&auth_content)?;
    let (response_email, response_plan) = account_metadata(responses);
    let email = response_email.or_else(|| auth_email(&auth_content));
    let plan = response_plan.or_else(|| auth_plan(&auth_content));
    let fallback_name = auth_display_name(&auth_content).or_else(|| {
        email
            .as_deref()
            .and_then(|value| value.split('@').next())
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    });

    let mut store = load_account_store()?;
    let existing_index = account_id
        .as_deref()
        .and_then(|current_account_id| {
            store
                .accounts
                .iter()
                .position(|account| account.account_id.as_deref() == Some(current_account_id))
        })
        .or_else(|| {
            store.accounts.iter().position(|account| {
                unprotect_secret(&account.auth_encrypted)
                    .is_ok_and(|stored_auth| stored_auth == auth_content)
            })
        });

    if let Some(index) = existing_index {
        let info = {
            let existing = &mut store.accounts[index];
            if !alias.trim().is_empty() {
                existing.name = alias.trim().to_string();
            }
            if account_id.is_some() {
                existing.account_id = account_id;
            }
            if email.is_some() {
                existing.email = email;
            }
            if plan.is_some() {
                existing.plan = plan;
            }
            existing.explicitly_added = true;
            existing.auth_encrypted = auth_encrypted;
            AccountInfo::from(&*existing)
        };
        if make_active {
            store.active_account_id = Some(info.id.clone());
        }
        save_account_store(&store)?;
        return Ok(info);
    }

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let managed_count = store
        .accounts
        .iter()
        .filter(|account| account.explicitly_added)
        .count();
    let base_name = fallback_name.unwrap_or_else(|| format!("Account {}", managed_count + 1));
    let name = if alias.trim().is_empty() {
        let mut candidate = base_name.clone();
        let mut duplicate = 2;
        while store
            .accounts
            .iter()
            .any(|account| account.explicitly_added && account.name == candidate)
        {
            candidate = format!("{base_name} · {duplicate}");
            duplicate += 1;
        }
        candidate
    } else {
        alias.trim().to_string()
    };
    let stored = StoredAccount {
        id: format!("account-{timestamp}"),
        account_id,
        explicitly_added: true,
        name,
        email,
        plan,
        auth_encrypted,
    };
    if make_active {
        store.active_account_id = Some(stored.id.clone());
    }
    store.accounts.push(stored.clone());
    save_account_store(&store)?;
    Ok(AccountInfo::from(&stored))
}

fn account_list_for_snapshot(
    responses: &HashMap<String, Value>,
    auth_path: &Path,
) -> Result<(Vec<AccountInfo>, Option<String>), String> {
    let mut store = load_account_store()?;
    let current_auth = fs::read_to_string(auth_path).ok();
    let current_account_id = current_auth.as_deref().and_then(auth_account_id);
    let active_index = current_account_id
        .as_deref()
        .and_then(|account_id| {
            store.accounts.iter().position(|account| {
                account.explicitly_added && account.account_id.as_deref() == Some(account_id)
            })
        })
        .or_else(|| {
            current_auth.as_deref().and_then(|current_auth| {
                store.accounts.iter().position(|account| {
                    account.explicitly_added
                        && unprotect_secret(&account.auth_encrypted)
                            .is_ok_and(|stored_auth| stored_auth == current_auth)
                })
            })
        });
    let mut changed = false;
    if let Some(index) = active_index {
        let active_id = store.accounts[index].id.clone();
        if store.active_account_id.as_deref() != Some(&active_id) {
            store.active_account_id = Some(active_id);
            changed = true;
        }
        if store.accounts[index].account_id.is_none() && current_account_id.is_some() {
            store.accounts[index].account_id = current_account_id;
            changed = true;
        }
        if store.accounts[index].name == "ChatGPT" {
            if let Some(name) = current_auth.as_deref().and_then(auth_display_name) {
                store.accounts[index].name = name.to_string();
                changed = true;
            }
        }
        let (email, plan) = account_metadata(responses);
        if email.is_some() && store.accounts[index].email != email {
            store.accounts[index].email = email;
            changed = true;
        }
        if plan.is_some() && store.accounts[index].plan != plan {
            store.accounts[index].plan = plan;
            changed = true;
        }
    }
    if changed {
        save_account_store(&store)?;
    }
    let accounts = store
        .accounts
        .iter()
        .filter(|account| account.explicitly_added)
        .map(AccountInfo::from)
        .collect();
    let active_account_id = active_index.map(|index| store.accounts[index].id.clone());
    Ok((accounts, active_account_id))
}

fn write_message(stdin: &mut impl Write, message: Value) -> Result<(), String> {
    writeln!(stdin, "{message}").map_err(|error| error.to_string())?;
    stdin.flush().map_err(|error| error.to_string())
}

fn send_snapshot_requests(stdin: &mut impl Write, threads_only: bool) -> Result<(), String> {
    write_message(stdin, json!({ "method": "initialized" }))?;
    write_message(
        stdin,
        json!({
          "method": "thread/list",
          "id": 2,
          "params": {
            "limit": 20,
            "sortKey": "updated_at",
            "sortDirection": "desc",
            "archived": false,
            "useStateDbOnly": true
          }
        }),
    )?;
    if threads_only {
        return Ok(());
    }
    write_message(
        stdin,
        json!({
          "method": "account/read",
          "id": 3,
          "params": { "refreshToken": false }
        }),
    )?;
    write_message(
        stdin,
        json!({ "method": "account/rateLimits/read", "id": 4 }),
    )?;
    write_message(stdin, json!({ "method": "account/usage/read", "id": 5 }))
}

fn query_codex_app_server(
    codex_home: Option<&Path>,
    threads_only: bool,
) -> Result<HashMap<String, Value>, String> {
    let mut command = hidden_command(codex_cli_path());
    if codex_home.is_some() {
        command.args(["-c", "cli_auth_credentials_store=\"file\""]);
    }
    command
        .args(["app-server", "--stdio"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    if let Some(path) = codex_home {
        command.env("CODEX_HOME", path);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Codex app-server: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or("Codex app-server stdout is unavailable")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Codex app-server stdin is unavailable")?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    write_message(
        &mut stdin,
        json!({
          "method": "initialize",
          "id": 1,
          "params": {
            "clientInfo": { "name": "codex-deck", "title": "Codex Deck", "version": "0.1.8" },
            "capabilities": null
          }
        }),
    )?;

    let deadline = Instant::now() + APP_SERVER_TIMEOUT;
    let mut requests_sent = false;
    let mut responses = HashMap::new();

    let expected_responses = if threads_only { 1 } else { 4 };
    while responses.len() < expected_responses {
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or("Codex app-server did not respond in time")?;
        let line = receiver
            .recv_timeout(remaining)
            .map_err(|_| "Codex app-server did not respond in time".to_string())?
            .map_err(|error| error.to_string())?;
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let Some(id) = message.get("id").and_then(Value::as_i64) else {
            continue;
        };

        if id == 1 && !requests_sent {
            send_snapshot_requests(&mut stdin, threads_only)?;
            requests_sent = true;
            continue;
        }

        if id == 2 || (!threads_only && (3..=5).contains(&id)) {
            let result = if message.get("error").is_some() {
                Value::Null
            } else {
                message.get("result").cloned().unwrap_or(Value::Null)
            };
            responses.insert(id.to_string(), result);
        }
    }

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    Ok(responses)
}

fn open_auth_url(auth_url: &str) -> Result<(), String> {
    if !auth_url.starts_with("https://") {
        return Err("Codex returned an invalid login URL".to_string());
    }
    hidden_command("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", auth_url])
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Could not open the login page: {error}"))
}

fn login_with_app_server(codex_home: &Path) -> Result<(), String> {
    let mut command = hidden_command(codex_cli_path());
    command
        .args([
            "-c",
            "cli_auth_credentials_store=\"file\"",
            "app-server",
            "--stdio",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("CODEX_HOME", codex_home);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Codex login service: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Codex login service stdout is unavailable")?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("Codex login service stdin is unavailable")?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line).is_err() {
                break;
            }
        }
    });

    write_message(
        &mut stdin,
        json!({
          "method": "initialize",
          "id": 1,
          "params": {
            "clientInfo": { "name": "codex-deck", "title": "Codex Deck", "version": "0.1.8" },
            "capabilities": null
          }
        }),
    )?;

    let result = (|| {
        let deadline = Instant::now() + LOGIN_TIMEOUT;
        let mut login_id: Option<String> = None;

        loop {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .ok_or("Codex login timed out")?;
            let line = receiver
                .recv_timeout(remaining)
                .map_err(|_| "Codex login timed out or the login service closed".to_string())?
                .map_err(|error| error.to_string())?;
            let Ok(message) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            if message.get("id").and_then(Value::as_i64) == Some(1) {
                if let Some(error) = message.get("error") {
                    return Err(format!("Could not initialize Codex login: {error}"));
                }
                write_message(&mut stdin, json!({ "method": "initialized" }))?;
                write_message(
                    &mut stdin,
                    json!({
                      "method": "account/login/start",
                      "id": 2,
                      "params": { "type": "chatgpt" }
                    }),
                )?;
                continue;
            }

            if message.get("id").and_then(Value::as_i64) == Some(2) {
                if let Some(error) = message.get("error") {
                    return Err(format!("Could not start Codex login: {error}"));
                }
                let response = message
                    .get("result")
                    .ok_or("Codex login returned no result")?;
                let id = response
                    .get("loginId")
                    .and_then(Value::as_str)
                    .ok_or("Codex login returned no login ID")?;
                let auth_url = response
                    .get("authUrl")
                    .and_then(Value::as_str)
                    .ok_or("Codex login returned no browser URL")?;
                open_auth_url(auth_url)?;
                login_id = Some(id.to_string());
                continue;
            }

            if message.get("method").and_then(Value::as_str) == Some("account/login/completed") {
                let params = message
                    .get("params")
                    .ok_or("Codex login completion had no details")?;
                let completed_id = params.get("loginId").and_then(Value::as_str);
                if completed_id.is_some() && completed_id != login_id.as_deref() {
                    continue;
                }
                if params.get("success").and_then(Value::as_bool) == Some(true) {
                    return Ok(());
                }
                return Err(params
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Codex login was cancelled or failed")
                    .to_string());
            }
        }
    })();

    drop(stdin);
    let _ = child.kill();
    let _ = child.wait();
    result
}

fn codex_desktop_pids() -> Result<Vec<u32>, String> {
    let script = r#"
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -eq 'ChatGPT.exe' -and
        $_.ExecutablePath -like '*OpenAI.Codex*' -and
        $_.CommandLine -notmatch '--type='
      } |
      ForEach-Object { $_.ProcessId }
  "#;
    let output = hidden_command("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .output()
        .map_err(|error| error.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(|line| line.trim().parse::<u32>().ok())
        .collect())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum RolloutState {
    Running,
    Completed,
    Error,
}

fn rollout_tail_state(content: &str) -> Option<RolloutState> {
    let mut lifecycle = None;
    let mut saw_runtime_activity = false;
    for line in content.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match row.get("type").and_then(Value::as_str) {
            Some("event_msg") => match row
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(Value::as_str)
            {
                Some("task_started" | "user_message") => lifecycle = Some(RolloutState::Running),
                Some("task_complete") => lifecycle = Some(RolloutState::Completed),
                Some("task_cancelled" | "turn_aborted") => lifecycle = Some(RolloutState::Error),
                Some("agent_reasoning" | "token_count") => saw_runtime_activity = true,
                _ => {}
            },
            Some("response_item") => saw_runtime_activity = true,
            _ => {}
        }
    }
    lifecycle.or_else(|| saw_runtime_activity.then_some(RolloutState::Running))
}

fn read_file_tail(path: &Path, byte_limit: u64) -> Option<String> {
    let metadata = fs::metadata(path).ok()?;
    let mut file = File::open(path).ok()?;
    let start = metadata.len().saturating_sub(byte_limit);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    if start > 0 {
        if let Some(first_newline) = bytes.iter().position(|byte| *byte == b'\n') {
            bytes.drain(..=first_newline);
        }
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn read_file_head(path: &Path, byte_limit: u64) -> Option<String> {
    let file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    file.take(byte_limit).read_to_end(&mut bytes).ok()?;
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

fn rollout_file_state(path: &Path) -> Option<(RolloutState, SystemTime, u64)> {
    let Ok(metadata) = fs::metadata(path) else {
        return None;
    };
    let Ok(modified) = metadata.modified() else {
        return None;
    };
    let Ok(age) = modified.elapsed() else {
        return None;
    };
    if age > COMPLETED_ROLLOUT_FRESHNESS {
        return None;
    }

    let content = read_file_tail(path, ROLLOUT_TAIL_BYTES)?;
    let state = rollout_tail_state(&content)?;
    if state == RolloutState::Running && age > ACTIVE_ROLLOUT_FRESHNESS {
        return None;
    }
    let total_tokens = content
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|row| {
            row.get("payload")
                .filter(|payload| {
                    payload.get("type").and_then(Value::as_str) == Some("token_count")
                })
                .and_then(|payload| payload.get("info"))
                .and_then(|info| info.get("total_token_usage"))
                .and_then(|usage| usage.get("total_tokens"))
                .and_then(Value::as_u64)
        })
        .last()
        .unwrap_or(0);
    Some((state, modified, total_tokens))
}

fn token_total(value: &Value, key: &str) -> u64 {
    value.get(key).and_then(Value::as_u64).unwrap_or(0)
}

fn rollout_model(content: &str) -> Option<String> {
    content
        .lines()
        .filter_map(|line| {
            let row = serde_json::from_str::<Value>(line).ok()?;
            (row.get("type").and_then(Value::as_str) == Some("turn_context"))
                .then(|| {
                    row.get("payload")
                        .and_then(|payload| payload.get("model"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|model| !model.is_empty())
                        .map(str::to_string)
                })
                .flatten()
        })
        .last()
}

fn local_usage_from_rollout(path: &Path) -> Option<(Option<String>, [u64; 4])> {
    let content = read_file_tail(path, ROLLOUT_TAIL_BYTES)?;
    let model = rollout_model(&content)
        .or_else(|| read_file_head(path, ROLLOUT_TAIL_BYTES).and_then(|head| rollout_model(&head)));
    let mut totals = None;
    for line in content.lines() {
        let Ok(row) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let total_usage = row
            .get("payload")
            .filter(|payload| payload.get("type").and_then(Value::as_str) == Some("token_count"))
            .and_then(|payload| payload.get("info"))
            .and_then(|info| info.get("total_token_usage"));
        if let Some(total_usage) = total_usage {
            totals = Some([
                token_total(total_usage, "total_tokens"),
                token_total(total_usage, "input_tokens"),
                token_total(total_usage, "cached_input_tokens"),
                token_total(total_usage, "output_tokens"),
            ]);
        }
    }
    Some((model, totals?))
}

fn compute_local_usage() -> LocalUsageSummary {
    let Ok(session_root) = codex_home_path().map(|path| path.join("sessions")) else {
        return LocalUsageSummary::default();
    };
    let mut candidates = Vec::new();
    let mut directories = vec![session_root];
    while let Some(directory) = directories.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                directories.push(path);
                continue;
            }
            let is_rollout = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"));
            let modified = entry
                .metadata()
                .ok()
                .and_then(|metadata| metadata.modified().ok());
            if is_rollout
                && modified.is_some_and(|modified| {
                    modified
                        .elapsed()
                        .is_ok_and(|age| age <= LOCAL_USAGE_MAX_AGE)
                })
            {
                candidates.push((path, modified.unwrap_or(UNIX_EPOCH)));
            }
        }
    }
    candidates.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));

    let mut summary = LocalUsageSummary::default();
    let mut models = HashMap::<String, u64>::new();
    for (path, _) in candidates.into_iter().take(LOCAL_USAGE_FILE_LIMIT) {
        let Some((model, totals)) = local_usage_from_rollout(&path) else {
            continue;
        };
        summary.total_tokens = summary.total_tokens.saturating_add(totals[0]);
        summary.input_tokens = summary.input_tokens.saturating_add(totals[1]);
        summary.cached_input_tokens = summary.cached_input_tokens.saturating_add(totals[2]);
        summary.output_tokens = summary.output_tokens.saturating_add(totals[3]);
        if let Some(model) = model {
            let model_total = models.entry(model).or_default();
            *model_total = model_total.saturating_add(totals[0]);
        }
    }
    summary.models = models
        .into_iter()
        .map(|(name, tokens)| LocalModelUsage { name, tokens })
        .collect();
    summary
        .models
        .sort_by_key(|model| std::cmp::Reverse(model.tokens));
    summary
}

fn local_usage_summary() -> LocalUsageSummary {
    let cache = LOCAL_USAGE_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some(cached) = guard.as_ref() {
            if cached.refreshed_at.elapsed() < LOCAL_USAGE_CACHE_TTL {
                return cached.summary.clone();
            }
        }
    }
    let summary = compute_local_usage();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(CachedLocalUsage {
            refreshed_at: Instant::now(),
            summary: summary.clone(),
        });
    }
    summary
}

fn rollout_thread_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    if stem.len() < 36 {
        return None;
    }
    let id = &stem[stem.len() - 36..];
    (id.matches('-').count() == 4).then(|| id.to_string())
}

fn recent_rollout_thread_states() -> HashMap<String, (RolloutState, SystemTime, u64)> {
    let Ok(session_root) = codex_home_path().map(|path| path.join("sessions")) else {
        return HashMap::new();
    };
    let mut states = HashMap::new();
    let mut directories = vec![session_root];
    while let Some(directory) = directories.pop() {
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                directories.push(path);
            } else if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("rollout-") && name.ends_with(".jsonl"))
            {
                if let (Some(id), Some(state)) =
                    (rollout_thread_id(&path), rollout_file_state(&path))
                {
                    states.insert(id, state);
                }
            }
        }
    }
    states
}

fn apply_runtime_thread_status(responses: &mut HashMap<String, Value>) -> Vec<RolloutTokenCounter> {
    let states = recent_rollout_thread_states();
    let mut completed = states
        .iter()
        .filter(|(_, (state, _, _))| *state == RolloutState::Completed)
        .map(|(id, (_, modified, _))| (id.clone(), *modified))
        .collect::<Vec<_>>();
    completed.sort_by_key(|(_, modified)| std::cmp::Reverse(*modified));
    let completed_ids = completed
        .into_iter()
        .take(COMPLETED_ROLLOUT_LIMIT)
        .map(|(id, _)| id)
        .collect::<HashSet<_>>();
    let Some(threads) = responses
        .get_mut("2")
        .and_then(|response| response.get_mut("data"))
        .and_then(Value::as_array_mut)
    else {
        return states
            .into_iter()
            .map(|(id, (_, _, total_tokens))| RolloutTokenCounter { id, total_tokens })
            .collect();
    };
    for thread in threads {
        let Some(id) = thread.get("id").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        if let Some((_, modified, _)) = states.get(&id) {
            if let Ok(updated_at) = modified.duration_since(UNIX_EPOCH) {
                thread["updatedAt"] = json!(updated_at.as_secs());
            }
        }
        match states.get(&id).map(|(state, _, _)| *state) {
            Some(RolloutState::Running) => {
                thread["status"] = json!({ "type": "active", "activeFlags": [] });
            }
            Some(RolloutState::Completed) if completed_ids.contains(&id) => {
                thread["status"] = json!({ "type": "idle" });
            }
            Some(RolloutState::Error) => {
                thread["status"] = json!({ "type": "systemError" });
            }
            _ if thread
                .get("status")
                .and_then(|status| status.get("type"))
                .and_then(Value::as_str)
                == Some("idle") =>
            {
                thread["status"] = json!({ "type": "notLoaded" });
            }
            _ => {}
        }
    }
    states
        .into_iter()
        .map(|(id, (_, _, total_tokens))| RolloutTokenCounter { id, total_tokens })
        .collect()
}

#[tauri::command]
async fn get_codex_snapshot() -> Result<RawCodexSnapshot, String> {
    let mut snapshot =
        tauri::async_runtime::spawn_blocking(|| -> Result<RawCodexSnapshot, String> {
            let mut responses = query_codex_app_server(None, false)?;
            let rollout_token_counters = apply_runtime_thread_status(&mut responses);
            let pids = codex_desktop_pids().unwrap_or_default();
            let active_account_name = codex_auth_path()
                .ok()
                .as_deref()
                .and_then(auth_display_name_from_path);
            let auth_path = codex_auth_path()?;
            let (accounts, active_account_id) = account_list_for_snapshot(&responses, &auth_path)?;
            Ok(RawCodexSnapshot {
                responses,
                process: ProcessInfo {
                    running: !pids.is_empty(),
                    count: pids.len(),
                },
                accounts,
                active_account_id,
                active_account_name,
                local_usage: local_usage_summary(),
                rollout_token_counters,
            })
        })
        .await
        .map_err(|error| error.to_string())??;
    let account_usage = managed_account_usage().await;
    for account in &mut snapshot.accounts {
        if let Some(usage) = account_usage.get(&account.id) {
            account.quota_remaining_percent = usage.quota_remaining_percent;
            account.reset_at = usage.reset_at;
            account.daily_usage = usage.daily_usage.clone();
            account.stats_as_of = usage.stats_as_of.clone();
            account.stats_generated_at = usage.stats_generated_at.clone();
            if usage.plan.is_some() {
                account.plan = usage.plan.clone();
            }
        }
    }
    Ok(snapshot)
}

#[tauri::command]
async fn get_codex_thread_snapshot() -> Result<RawCodexThreadSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<RawCodexThreadSnapshot, String> {
        let mut responses = query_codex_app_server(None, true)?;
        apply_runtime_thread_status(&mut responses);
        let pids = codex_desktop_pids().unwrap_or_default();
        Ok(RawCodexThreadSnapshot {
            response: responses.remove("2").unwrap_or(Value::Null),
            process: ProcessInfo {
                running: !pids.is_empty(),
                count: pids.len(),
            },
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn set_compact_window(
    window: WebviewWindow,
    geometry: State<'_, MainWindowGeometry>,
) -> Result<(), String> {
    enable_native_rounded_corners(&window);
    remember_main_window_geometry(&window, &geometry)?;
    window
        .set_min_size(Some(LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT)))
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(true)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(true)
        .map_err(|error| error.to_string())?;
    window
        .set_size(LogicalSize::new(COMPACT_WIDTH, COMPACT_HEIGHT))
        .map_err(|error| error.to_string())?;

    if let Some(monitor) = window
        .current_monitor()
        .map_err(|error| error.to_string())?
    {
        let monitor_size = monitor.size();
        let monitor_position = monitor.position();
        let compact_width = (COMPACT_WIDTH * monitor.scale_factor()).round() as i32;
        let x = monitor_position.x + (monitor_size.width as i32 - compact_width) / 2;
        window
            .set_position(PhysicalPosition::new(x, monitor_position.y))
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn restore_main_window_view(
    window: &WebviewWindow,
    geometry: &MainWindowGeometry,
) -> Result<(), String> {
    enable_native_rounded_corners(window);
    window
        .set_min_size(Some(LogicalSize::new(MAIN_MIN_WIDTH, MAIN_MIN_HEIGHT)))
        .map_err(|error| error.to_string())?;
    window
        .set_always_on_top(false)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())?;
    window
        .set_skip_taskbar(false)
        .map_err(|error| error.to_string())?;
    let saved = *geometry.0.lock().map_err(|error| error.to_string())?;
    if let Some(saved) = saved {
        window
            .set_size(saved.size)
            .map_err(|error| error.to_string())?;
        window
            .set_position(saved.position)
            .map_err(|error| error.to_string())?;
    } else {
        window
            .set_size(LogicalSize::new(MAIN_WIDTH, MAIN_HEIGHT))
            .map_err(|error| error.to_string())?;
        window.center().map_err(|error| error.to_string())?;
    }
    window
        .eval("window.dispatchEvent(new Event('codex-deck:restore'))")
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

fn remember_main_window_geometry(
    window: &WebviewWindow,
    geometry: &MainWindowGeometry,
) -> Result<(), String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    if size.width <= COMPACT_WIDTH as u32 && size.height <= COMPACT_POPOVER_MAX_HEIGHT as u32 {
        return Ok(());
    }
    let saved = WindowGeometry {
        size,
        position: window.outer_position().map_err(|error| error.to_string())?,
    };
    *geometry.0.lock().map_err(|error| error.to_string())? = Some(saved);
    save_window_geometry(saved)
}

fn save_current_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let geometry = app.state::<MainWindowGeometry>();
        let _ = remember_main_window_geometry(&window, &geometry);
    }
}

fn compact_popover_height(open: bool, item_count: usize) -> f64 {
    if !open {
        return COMPACT_HEIGHT;
    }
    (COMPACT_HEIGHT + 64.0 + item_count.clamp(1, COMPLETED_ROLLOUT_LIMIT) as f64 * 58.0)
        .min(COMPACT_POPOVER_MAX_HEIGHT)
}

#[tauri::command]
fn set_compact_popover(window: WebviewWindow, open: bool, item_count: usize) -> Result<(), String> {
    let height = compact_popover_height(open, item_count);
    window
        .set_size(LogicalSize::new(COMPACT_WIDTH, height))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn restore_main_window(
    window: WebviewWindow,
    geometry: State<'_, MainWindowGeometry>,
) -> Result<(), String> {
    restore_main_window_view(&window, &geometry)
}

#[tauri::command]
fn start_window_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn set_main_window_size(
    window: WebviewWindow,
    geometry: State<'_, MainWindowGeometry>,
    compact: bool,
) -> Result<(), String> {
    let (width, height) = if compact {
        (1040.0, 700.0)
    } else {
        (MAIN_WIDTH, MAIN_HEIGHT)
    };
    window
        .set_size(LogicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    remember_main_window_geometry(&window, &geometry)
}

#[tauri::command]
fn open_codex() -> Result<(), String> {
    hidden_command(codex_cli_path())
        .arg("app")
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn valid_thread_id(thread_id: &str) -> bool {
    thread_id.len() == 36
        && thread_id
            .bytes()
            .enumerate()
            .all(|(index, byte)| match index {
                8 | 13 | 18 | 23 => byte == b'-',
                _ => byte.is_ascii_hexdigit(),
            })
}

#[tauri::command]
fn open_codex_thread(thread_id: String) -> Result<(), String> {
    if !valid_thread_id(&thread_id) {
        return Err("Invalid Codex task ID".to_string());
    }
    let url = format!("codex://threads/{thread_id}");
    let wide_url = OsStr::new(&url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            std::ptr::null(),
            wide_url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    if result <= 32 {
        return Err(format!(
            "Could not open Codex task (ShellExecuteW {result})"
        ));
    }
    Ok(())
}

fn tray_labels(language: &str) -> (&'static str, &'static str) {
    if language == "en" {
        ("Open Codex Deck", "Exit Codex Deck")
    } else {
        ("打开 Codex Deck", "退出 Codex Deck")
    }
}

#[tauri::command]
fn set_tray_language(app: AppHandle, language: String) -> Result<(), String> {
    let (show_label, quit_label) = tray_labels(&language);
    let show = MenuItem::with_id(&app, "show", show_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(&app, "quit", quit_label, true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let menu = Menu::with_items(&app, &[&show, &quit]).map_err(|error| error.to_string())?;
    let tray = app
        .tray_by_id("codex-deck")
        .ok_or_else(|| "Codex Deck tray is unavailable".to_string())?;
    tray.set_menu(Some(menu)).map_err(|error| error.to_string())
}

#[tauri::command]
async fn login_codex_account(alias: String) -> Result<AccountInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let current_auth_path = codex_auth_path()?;
        let current_auth_exists = current_auth_path.is_file();
        let codex_running = !codex_desktop_pids()?.is_empty();

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis();
        let login_home = env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .ok_or("LOCALAPPDATA is unavailable".to_string())?
            .join("Codex Deck")
            .join("login-sessions")
            .join(format!("{}-{timestamp}", std::process::id()));
        fs::create_dir_all(&login_home).map_err(|error| error.to_string())?;

        let result = (|| {
            login_with_app_server(&login_home)
                .map_err(|error| format!("Official login failed: {error}"))?;
            let isolated_auth_path = login_home.join("auth.json");
            if !isolated_auth_path.is_file() {
                return Err("Official login completed but returned no credentials".to_string());
            }
            let make_active = should_activate_added_account(current_auth_exists, codex_running);
            if make_active {
                let auth_content = fs::read_to_string(&isolated_auth_path).map_err(|error| {
                    format!("Could not read {}: {error}", isolated_auth_path.display())
                })?;
                if let Some(parent) = current_auth_path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                fs::write(&current_auth_path, auth_content).map_err(|error| {
                    format!("Could not write {}: {error}", current_auth_path.display())
                })?;
            }
            save_account_from_auth(alias, &HashMap::new(), &isolated_auth_path, make_active)
        })();

        let cleanup = fs::remove_dir_all(&login_home);
        match result {
            Ok(info) => {
                let _ = cleanup;
                Ok(info)
            }
            Err(error) => {
                let _ = cleanup;
                Err(error)
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn switch_codex_account(account_id: String) -> Result<AccountInfo, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if !codex_desktop_pids()?.is_empty() {
            return Err("Close Codex before switching accounts".to_string());
        }
        let mut store = load_account_store()?;
        let account = store
            .accounts
            .iter()
            .find(|account| account.explicitly_added && account.id == account_id)
            .cloned()
            .ok_or("Account not found".to_string())?;
        let auth_path = codex_auth_path()?;
        if let Some(parent) = auth_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let auth = unprotect_secret(&account.auth_encrypted)?;
        serde_json::from_str::<Value>(&auth).map_err(|error| error.to_string())?;
        fs::write(&auth_path, auth)
            .map_err(|error| format!("Could not write {}: {error}", auth_path.display()))?;
        store.active_account_id = Some(account.id.clone());
        save_account_store(&store)?;
        Ok(AccountInfo::from(&account))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn force_close_codex() -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let pids = codex_desktop_pids()?;
        let mut killed = 0;
        for pid in pids {
            let status = hidden_command("taskkill.exe")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .status()
                .map_err(|error| error.to_string())?;
            if status.success() {
                killed += 1;
            }
        }
        Ok(killed)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn quit_deck(app: AppHandle) {
    save_current_main_window(&app);
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let initial_geometry = load_window_geometry().unwrap_or(None);
    tauri::Builder::default()
        .manage(MainWindowGeometry(Mutex::new(initial_geometry)))
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                enable_native_rounded_corners(&window);
                let saved = app
                    .state::<MainWindowGeometry>()
                    .0
                    .lock()
                    .ok()
                    .and_then(|geometry| *geometry);
                if let Some(saved) = saved {
                    window.set_size(saved.size)?;
                    window.set_position(saved.position)?;
                }
            }
            let (show_label, quit_label) = tray_labels("zh");
            let show = MenuItem::with_id(app, "show", show_label, true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", quit_label, true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let mut tray = TrayIconBuilder::with_id("codex-deck")
                .tooltip("Codex Deck")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let geometry = app.state::<MainWindowGeometry>();
                            let _ = restore_main_window_view(&window, &geometry);
                        }
                    }
                    "quit" => {
                        save_current_main_window(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let geometry = tray.app_handle().state::<MainWindowGeometry>();
                            let _ = restore_main_window_view(&window, &geometry);
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_codex_snapshot,
            get_codex_thread_snapshot,
            set_compact_window,
            set_compact_popover,
            restore_main_window,
            start_window_drag,
            set_main_window_size,
            open_codex,
            open_codex_thread,
            set_tray_language,
            login_codex_account,
            switch_codex_account,
            force_close_codex,
            quit_deck,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codex Deck");
}

#[cfg(test)]
mod tests {
    use super::{
        apply_refreshed_tokens, auth_account_id, auth_display_name, auth_email, auth_plan,
        compact_popover_height, parse_account_usage, parse_profile_daily_usage,
        protect_secret, rollout_model, rollout_tail_state, should_activate_added_account, unprotect_secret,
        tray_labels, valid_stored_window_geometry, valid_thread_id, RolloutState, StoredAccount,
        StoredWindowGeometry, COMPACT_HEIGHT, COMPACT_POPOVER_MAX_HEIGHT,
    };

    #[test]
    fn windows_user_secret_round_trip() {
        let sample = r#"{"tokens":{"access_token":"test-only"}}"#;
        let encrypted = protect_secret(sample).expect("secret should encrypt");
        assert_ne!(encrypted, sample);
        assert_eq!(
            unprotect_secret(&encrypted).expect("secret should decrypt"),
            sample
        );
    }

    #[test]
    fn isolated_login_only_activates_the_first_idle_account() {
        assert!(should_activate_added_account(false, false));
        assert!(!should_activate_added_account(true, false));
        assert!(!should_activate_added_account(false, true));
        assert!(!should_activate_added_account(true, true));
    }

    #[test]
    fn validates_codex_thread_ids_before_building_deep_links() {
        assert!(valid_thread_id("019f5a56-9be1-7a40-87ce-2aaab1b3dd14"));
        assert!(!valid_thread_id("../../settings"));
        assert!(!valid_thread_id("019f5a56-9be1-7a40-87ce-2aaab1b3dd1z"));
    }

    #[test]
    fn localizes_tray_menu_labels() {
        assert_eq!(tray_labels("zh"), ("打开 Codex Deck", "退出 Codex Deck"));
        assert_eq!(tray_labels("en"), ("Open Codex Deck", "Exit Codex Deck"));
    }

    #[test]
    fn stored_window_geometry_round_trips_and_rejects_compact_size() {
        let stored = StoredWindowGeometry {
            width: 1440,
            height: 900,
            x: 100,
            y: 50,
        };
        let json = serde_json::to_string(&stored).expect("window geometry should serialize");
        assert_eq!(
            serde_json::from_str::<StoredWindowGeometry>(&json)
                .expect("window geometry should deserialize"),
            stored
        );
        assert!(valid_stored_window_geometry(stored));
        assert!(!valid_stored_window_geometry(StoredWindowGeometry {
            width: 504,
            height: 54,
            ..stored
        }));
    }

    #[test]
    fn reads_chatgpt_display_name_from_id_token() {
        let auth = r#"{"tokens":{"id_token":"header.eyJuYW1lIjoiRXhhbXBsZSBVc2VyIn0.signature"}}"#;
        assert_eq!(auth_display_name(auth).as_deref(), Some("Example User"));
    }

    #[test]
    fn reads_stable_chatgpt_account_id() {
        let auth = r#"{"tokens":{"account_id":"account-pro"}}"#;
        assert_eq!(auth_account_id(auth).as_deref(), Some("account-pro"));
    }

    #[test]
    fn reads_account_metadata_from_id_token_without_remote_lookup() {
        let auth = r#"{"tokens":{"id_token":"header.eyJlbWFpbCI6InVzZXJAZXhhbXBsZS5jb20iLCJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9wbGFuX3R5cGUiOiJwbHVzIiwiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdC0yIn19.signature"}}"#;
        assert_eq!(auth_email(auth).as_deref(), Some("user@example.com"));
        assert_eq!(auth_plan(auth).as_deref(), Some("plus"));
        assert_eq!(auth_account_id(auth).as_deref(), Some("acct-2"));
    }

    #[test]
    fn legacy_accounts_are_not_explicitly_managed() {
        let legacy = r#"{
            "id":"account-old",
            "accountId":"chatgpt-account",
            "name":"Example User",
            "email":null,
            "plan":"pro",
            "authEncrypted":"encrypted"
        }"#;
        let account: StoredAccount = serde_json::from_str(legacy).expect("legacy account loads");
        assert!(!account.explicitly_added);
    }

    #[test]
    fn prefers_weekly_usage_window_when_available() {
        let payload = serde_json::json!({
            "plan_type": "pro",
            "rate_limit": {
                "primary_window": { "used_percent": 12.0, "reset_at": 10 },
                "secondary_window": { "used_percent": 37.5, "reset_at": 20 }
            }
        });
        let usage = parse_account_usage(&payload);
        assert_eq!(usage.quota_remaining_percent, Some(62.5));
        assert_eq!(usage.reset_at, Some(20));
        assert_eq!(usage.plan.as_deref(), Some("pro"));
    }

    #[test]
    fn refreshed_tokens_preserve_missing_optional_values() {
        let auth = r#"{"tokens":{"id_token":"old-id","access_token":"old-access","refresh_token":"old-refresh"}}"#;
        let refreshed =
            apply_refreshed_tokens(auth, &serde_json::json!({ "access_token": "new-access" }))
                .expect("tokens should update");
        let value: serde_json::Value = serde_json::from_str(&refreshed).unwrap();
        assert_eq!(value["tokens"]["access_token"], "new-access");
        assert_eq!(value["tokens"]["id_token"], "old-id");
        assert_eq!(value["tokens"]["refresh_token"], "old-refresh");
    }

    #[test]
    fn maps_profile_daily_usage_without_negative_tokens() {
        let payload = serde_json::json!({
            "stats": {
                "daily_usage_buckets": [
                    { "start_date": "2026-07-13", "tokens": 125 },
                    { "start_date": "2026-07-14", "tokens": -4 }
                ]
            }
        });
        let daily = parse_profile_daily_usage(&payload);
        assert_eq!(daily.len(), 2);
        assert_eq!(daily[0].date, "2026-07-13");
        assert_eq!(daily[0].tokens, 125);
        assert_eq!(daily[1].tokens, 0);
    }

    #[test]
    fn reads_model_from_rollout_context() {
        let content = r#"{"type":"turn_context","payload":{"model":"gpt-5.6-sol"}}
{"type":"event_msg","payload":{"type":"token_count"}}"#;
        assert_eq!(rollout_model(content).as_deref(), Some("gpt-5.6-sol"));
    }

    #[test]
    fn compact_popover_height_tracks_visible_rows_and_caps_at_maximum() {
        assert_eq!(compact_popover_height(false, 5), COMPACT_HEIGHT);
        assert_eq!(compact_popover_height(true, 1), 176.0);
        assert_eq!(compact_popover_height(true, 5), COMPACT_POPOVER_MAX_HEIGHT);
    }

    #[test]
    fn detects_active_and_completed_rollout_tails() {
        let active = r#"{"type":"event_msg","payload":{"type":"task_started"}}
{"type":"event_msg","payload":{"type":"user_message"}}
{"type":"response_item","payload":{"type":"reasoning"}}"#;
        let completed = format!(
            "{active}\n{{\"type\":\"event_msg\",\"payload\":{{\"type\":\"task_complete\"}}}}"
        );
        assert_eq!(rollout_tail_state(active), Some(RolloutState::Running));
        assert_eq!(
            rollout_tail_state(&completed),
            Some(RolloutState::Completed)
        );
    }
}
