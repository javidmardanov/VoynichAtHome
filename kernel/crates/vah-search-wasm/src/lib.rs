//! Small C ABI for bounded search calls; no host imports.
use serde::Deserialize;
use std::sync::Mutex;
pub mod generation;
static OUTPUT: Mutex<Vec<u8>> = Mutex::new(Vec::new());
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Request {
    Generate {
        input: generation::Input,
    },
    GenerationStep {
        input: generation::Input,
        checkpoint: Option<generation::Checkpoint>,
    },
    GenerationFinish {
        input: generation::Input,
        checkpoint: generation::Checkpoint,
    },
    Verify {
        job: vah_search::Job,
        result: vah_search::ResultRecord,
    },
    VerificationFinish {
        job: vah_search::Job,
        result: vah_search::ResultRecord,
        checkpoint: vah_search::Checkpoint,
    },
    Run {
        job: vah_search::Job,
    },
    Step {
        job: vah_search::Job,
        checkpoint: Option<vah_search::Checkpoint>,
        proposals: u32,
    },
    Finish {
        job: vah_search::Job,
        checkpoint: vah_search::Checkpoint,
    },
    Check {
        job: vah_search::Job,
        result: vah_search::ResultRecord,
    },
}
pub fn execute(s: &str) -> Result<String, String> {
    let request: Request = serde_json::from_str(s).map_err(|e| e.to_string())?;
    let value = match request {
        Request::Generate { input } => Ok(generation::run(&input)?),
        Request::GenerationStep { input, checkpoint } => serde_json::to_value(generation::step(&input, checkpoint)?),
        Request::GenerationFinish { input, checkpoint } => Ok(generation::finish(&input, checkpoint)?),
        Request::Verify { job, result } => {
            vah_search::check_candidate(&job, &result)?;
            let replay = vah_search::run(&job)?;
            Ok(serde_json::json!({"version":"vah-verification-result-1","job_digest":replay.job_digest,"expected_result_digest":result.result_digest,"actual_result_digest":replay.result_digest,"matches":replay==result}))
        },
        Request::VerificationFinish { job, result, checkpoint } => {
            vah_search::check_candidate(&job, &result)?;
            let replay = vah_search::finish(&job, checkpoint)?;
            Ok(serde_json::json!({"version":"vah-verification-result-1","job_digest":replay.job_digest,"expected_result_digest":result.result_digest,"actual_result_digest":replay.result_digest,"matches":replay==result}))
        },
        Request::Run { job } => serde_json::to_value(vah_search::run(&job)?),
        Request::Step {
            job,
            checkpoint,
            proposals,
        } => serde_json::to_value(vah_search::step(&job, checkpoint, proposals)?),
        Request::Finish { job, checkpoint } => {
            serde_json::to_value(vah_search::finish(&job, checkpoint)?)
        }
        Request::Check { job, result } => {
            vah_search::check_candidate(&job, &result)?;
            Ok(serde_json::json!({"candidate_checked":true,"execution_proven":false}))
        }
    }
    .map_err(|e| e.to_string())?;
    serde_json::to_string(&value).map_err(|e| e.to_string())
}
#[no_mangle]
pub extern "C" fn vah_alloc(len: usize) -> *mut u8 {
    if len > 8_000_000 {
        return std::ptr::null_mut();
    }
    let mut v = Vec::<u8>::with_capacity(len);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}
/// # Safety
/// Pointer must be returned by vah_alloc with this length and freed once.
#[no_mangle]
pub unsafe extern "C" fn vah_free(ptr: *mut u8, len: usize) {
    if !ptr.is_null() {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }
}
/// # Safety
/// Input must be a valid readable allocation of length len.
#[no_mangle]
pub unsafe extern "C" fn vah_search(ptr: *const u8, len: usize) -> u32 {
    let result = if ptr.is_null() || len > 8_000_000 {
        Err("input exceeds bound".into())
    } else {
        std::str::from_utf8(std::slice::from_raw_parts(ptr, len))
            .map_err(|e| e.to_string())
            .and_then(execute)
    };
    let (status, bytes) = match result {
        Ok(s) => (0, s.into_bytes()),
        Err(e) => (
            1,
            serde_json::to_vec(&serde_json::json!({"error":e})).unwrap(),
        ),
    };
    *OUTPUT.lock().unwrap_or_else(|e| e.into_inner()) = bytes;
    status
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
    OUTPUT.lock().unwrap_or_else(|e| e.into_inner()).clear();
}
