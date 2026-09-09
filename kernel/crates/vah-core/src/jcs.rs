//! RFC 8785 JSON Canonicalization Scheme (JCS).
//!
//! * Object members sorted by property name compared as UTF-16 code units.
//! * No whitespace.
//! * Numbers serialised as ECMAScript `Number.prototype.toString`: shortest
//!   round-trip digits; integers without a fraction; exponent notation with
//!   an explicit sign for magnitudes at or above 1e21 and below 1e-6;
//!   negative zero is `0`; NaN and infinities are rejected.
//! * Strings escaped with `\"`, `\\`, `\b`, `\f`, `\n`, `\r`, `\t`, and
//!   `\u00xx` (lowercase hex) for other control characters; everything else,
//!   including non-ASCII, is emitted verbatim.
//!
//! Shared conformance vectors live in `contracts/jcs-vectors.json` so that
//! the Python contract tooling can check the same cases.

use std::cmp::Ordering;
use std::fmt::Write as _;

use serde_json::Value;

/// A value that JCS cannot represent.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum JcsError {
    /// NaN or infinity.
    NonFinite,
}

impl std::fmt::Display for JcsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "JCS cannot represent a non-finite number")
    }
}

impl std::error::Error for JcsError {}

/// Canonical JSON text of a value.
pub fn canonicalize(v: &Value) -> Result<String, JcsError> {
    let mut out = String::new();
    write_value(v, &mut out)?;
    Ok(out)
}

fn write_value(v: &Value, out: &mut String) -> Result<(), JcsError> {
    match v {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let f = n.as_f64().ok_or(JcsError::NonFinite)?;
            out.push_str(&es6_number(f)?);
        }
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out)?;
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|a, b| utf16_cmp(a, b));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_string(k, out);
                out.push(':');
                write_value(&map[k.as_str()], out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn utf16_cmp(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

fn write_string(s: &str, out: &mut String) {
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// ECMAScript `Number.prototype.toString` for a finite double.
pub fn es6_number(x: f64) -> Result<String, JcsError> {
    if !x.is_finite() {
        return Err(JcsError::NonFinite);
    }
    if x == 0.0 {
        return Ok("0".to_string());
    }
    if x < 0.0 {
        return Ok(format!("-{}", es6_number(-x)?));
    }
    // Rust's `{:e}` prints the shortest digit string that round-trips,
    // e.g. "1.2345e3", "1e0", "5e-324".
    let sci = format!("{x:e}");
    let (mantissa, exp) = sci.split_once('e').expect("exponent form");
    let exp: i32 = exp.parse().expect("integer exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp + 1; // value = 0.<digits> * 10^n
    let s = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        let (a, b) = digits.split_at(n as usize);
        format!("{a}.{b}")
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        if k == 1 {
            format!("{digits}e{sign}{}", e.abs())
        } else {
            let (a, b) = digits.split_at(1);
            format!("{a}.{b}e{sign}{}", e.abs())
        }
    };
    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[allow(clippy::excessive_precision)]
    fn numbers_follow_es6() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (10.0, "10"),
            (100.0, "100"),
            (0.1, "0.1"),
            (4.5, "4.5"),
            (0.002, "0.002"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (5e-7, "5e-7"),
            (1e21, "1e+21"),
            (1e30, "1e+30"),
            (1e-27, "1e-27"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.2345678901234568e21, "1.2345678901234568e+21"),
            (333333333.33333329, "333333333.3333333"),
            (9007199254740992.0, "9007199254740992"),
            (-1.5, "-1.5"),
            (5e-324, "5e-324"),
            (f64::MAX, "1.7976931348623157e+308"),
        ];
        for (x, want) in cases {
            assert_eq!(es6_number(*x).unwrap(), *want, "{x:?}");
        }
        assert_eq!(es6_number(f64::NAN), Err(JcsError::NonFinite));
        assert_eq!(es6_number(f64::INFINITY), Err(JcsError::NonFinite));
    }

    #[test]
    fn objects_strings_and_sorting() {
        // The RFC 8785 section 3.2.3 example, written with JSON escapes.
        let input = concat!(
            "{\"numbers\":[333333333.33333329, 1E30, 4.50, 2e-3, 0.000000000000000000000000001],",
            "\"string\":\"\\u20ac$\\u000F\\u000aA'\\u0042\\u0022\\u005c\\\\\\\"\\/\",",
            "\"literals\":[null,true,false]}"
        );
        let v: Value = serde_json::from_str(input).unwrap();
        let expected_string = "\u{20ac}$\\u000f\\nA'B\\\"\\\\\\\\\\\"/";
        let expected = format!(
            "{{\"literals\":[null,true,false],\"numbers\":[333333333.3333333,1e+30,4.5,0.002,1e-27],\"string\":\"{expected_string}\"}}"
        );
        assert_eq!(canonicalize(&v).unwrap(), expected);
        // UTF-16 order: U+1D11E is the surrogate pair D834 DD1E and D834 < FF5E, so the
        // supplementary character sorts before U+FF5E. UTF-8 byte order (F0 9D 84 9E versus
        // EF BD 9E) would put U+FF5E first, so sorting by UTF-8 bytes fails this case.
        let v: Value = serde_json::from_str("{\"\u{1D11E}\":1,\"\u{FF5E}\":2,\"a\":3}").unwrap();
        assert_eq!(
            canonicalize(&v).unwrap(),
            "{\"a\":3,\"\u{1D11E}\":1,\"\u{FF5E}\":2}"
        );
        let v: Value =
            serde_json::from_str("{\"b\":{\"y\":[1,2],\"x\":-0.0},\"a\":\"\\t\\u0001\"}").unwrap();
        assert_eq!(
            canonicalize(&v).unwrap(),
            "{\"a\":\"\\t\\u0001\",\"b\":{\"x\":0,\"y\":[1,2]}}"
        );
    }

    #[test]
    fn shared_conformance_vectors() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../contracts/jcs-vectors.json");
        let text = std::fs::read_to_string(&path).expect("contracts/jcs-vectors.json");
        let file: Value = serde_json::from_str(&text).unwrap();
        for case in file["vectors"].as_array().unwrap() {
            let got = canonicalize(&case["input"]).unwrap();
            assert_eq!(
                got,
                case["expected"].as_str().unwrap(),
                "vector {}",
                case["name"]
            );
        }
        for case in file["numbers"].as_array().unwrap() {
            let bits = u64::from_str_radix(case["hex"].as_str().unwrap(), 16).unwrap();
            let x = f64::from_bits(bits);
            assert_eq!(
                es6_number(x).unwrap(),
                case["expected"].as_str().unwrap(),
                "number {}",
                case["hex"]
            );
        }
    }
}
