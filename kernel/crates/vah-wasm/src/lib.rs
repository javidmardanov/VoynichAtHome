//! WebAssembly entry points of the science kernel.
//!
//! The module exports a tiny C ABI so that a Web Worker (or Node) can run a
//! job with the plain `WebAssembly` API and no generated glue:
//!
//! ```text
//! vah_alloc(len) -> ptr            allocate an input buffer in wasm memory
//! vah_free(ptr, len)               release a buffer from vah_alloc
//! vah_run_job(ptr, len) -> status  run the job JSON at ptr; 0 = ok, 1 = error
//! vah_generate_seed(ptr, len, seed)  text of one seed of the job, into the output buffer
//! vah_out_ptr() / vah_out_len()    the result (or error) JSON of the last run
//! vah_out_clear()                  release the result buffer
//! vah_kernel_version_ptr()/_len()  the kernel version string
//! ```
//!
//! The host may provide `env.vah_progress(done, total)`; it is called after
//! every seed. On non-wasm targets the import is a no-op so the crate still
//! compiles and tests natively.
//!
//! The only `unsafe` in the kernel lives here, at the FFI boundary.

use std::sync::Mutex;

static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
extern "C" {
    fn vah_progress(done: u32, total: u32);
}

#[cfg(not(target_arch = "wasm32"))]
#[allow(non_snake_case)]
unsafe fn vah_progress(_done: u32, _total: u32) {}

fn set_output(bytes: Vec<u8>) {
    *OUTPUT.lock().unwrap_or_else(|e| e.into_inner()) = bytes;
}

/// Run a job given as JSON; returns the result JSON or an error JSON.
pub fn run_job_str(job_json: &str) -> Result<String, String> {
    let job: vah_core::Job = serde_json_from(job_json)?;
    let result = vah_core::run_job(&job, |done, total| unsafe { vah_progress(done, total) })
        .map_err(|e| e.to_string())?;
    serde_json_to(&result)
}

fn serde_json_from(s: &str) -> Result<vah_core::Job, String> {
    // vah-core re-exports nothing of serde_json; go through its public API.
    vah_core::parse_job(s).map_err(|e| e.to_string())
}

fn serde_json_to(r: &vah_core::WorkResult) -> Result<String, String> {
    vah_core::result_to_json(r).map_err(|e| e.to_string())
}

#[no_mangle]
pub extern "C" fn vah_alloc(len: usize) -> *mut u8 {
    let mut v: Vec<u8> = Vec::with_capacity(len);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

/// # Safety
/// `ptr` must come from `vah_alloc(len)` and not have been freed.
#[no_mangle]
pub unsafe extern "C" fn vah_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}

/// # Safety
/// `ptr..ptr+len` must be readable wasm memory holding UTF-8 JSON.
#[no_mangle]
pub unsafe extern "C" fn vah_run_job(ptr: *const u8, len: usize) -> u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let job = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => {
            set_output(format!("{{\"error\":\"input is not UTF-8: {e}\"}}").into_bytes());
            return 1;
        }
    };
    match run_job_str(job) {
        Ok(json) => {
            set_output(json.into_bytes());
            0
        }
        Err(msg) => {
            let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
            set_output(format!("{{\"error\":\"{escaped}\"}}").into_bytes());
            1
        }
    }
}

/// Generate the text of one seed of the job JSON at `ptr` and place it in
/// the output buffer (for specimens and the verification page). Returns 0
/// on success, 1 on error (the output then holds an error JSON).
///
/// # Safety
/// `ptr..ptr+len` must be readable wasm memory holding UTF-8 JSON.
#[no_mangle]
pub unsafe extern "C" fn vah_generate_seed(ptr: *const u8, len: usize, seed: u64) -> u32 {
    let bytes = std::slice::from_raw_parts(ptr, len);
    let text = std::str::from_utf8(bytes)
        .map_err(|e| e.to_string())
        .and_then(|s| {
            let job = vah_core::parse_job(s).map_err(|e| e.to_string())?;
            vah_core::generate_seed(&job, seed)
                .map(|c| c.to_text())
                .map_err(|e| e.to_string())
        });
    match text {
        Ok(t) => {
            set_output(t.into_bytes());
            0
        }
        Err(msg) => {
            let escaped = msg.replace('\\', "\\\\").replace('"', "\\\"");
            set_output(format!("{{\"error\":\"{escaped}\"}}").into_bytes());
            1
        }
    }
}

#[no_mangle]
pub extern "C" fn vah_out_ptr() -> *const u8 {
    OUTPUT.lock().unwrap_or_else(|e| e.into_inner()).as_ptr()
}

#[no_mangle]
pub extern "C" fn vah_out_len() -> usize {
    OUTPUT.lock().unwrap_or_else(|e| e.into_inner()).len()
}

#[no_mangle]
pub extern "C" fn vah_out_clear() {
    set_output(Vec::new());
}

#[no_mangle]
pub extern "C" fn vah_kernel_version_ptr() -> *const u8 {
    vah_core::KERNEL_VERSION.as_ptr()
}

#[no_mangle]
pub extern "C" fn vah_kernel_version_len() -> usize {
    vah_core::KERNEL_VERSION.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ffi_round_trip_reports_errors_as_json() {
        let input = b"not json";
        let status = unsafe { vah_run_job(input.as_ptr(), input.len()) };
        assert_eq!(status, 1);
        let out = unsafe { std::slice::from_raw_parts(vah_out_ptr(), vah_out_len()) };
        assert!(std::str::from_utf8(out).unwrap().starts_with("{\"error\":"));
        vah_out_clear();
        assert_eq!(vah_out_len(), 0);
        let p = vah_alloc(16);
        unsafe { vah_free(p, 16) };
    }
}
