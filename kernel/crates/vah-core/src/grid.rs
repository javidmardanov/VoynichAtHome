//! Parameter grids: the registered enumeration of parameter points of one
//! generator family. A grid is a JSON document; its digest is part of the
//! experiment record, and the points are enumerated in a fixed order.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use vah_generators::Params;

use crate::{CoreError, MAX_SEEDS_PER_UNIT};

/// A registered parameter grid.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Grid {
    pub experiment_id: String,
    pub family: String,
    /// Parameters shared by every point.
    #[serde(default)]
    pub fixed: Params,
    /// Axes: parameter name -> values. Points are the Cartesian product,
    /// enumerated with the first axis (alphabetically) varying slowest.
    pub axes: BTreeMap<String, Vec<Value>>,
    /// Replicates (seeds `0..replicates`) per point.
    pub replicates: u32,
    /// Truncate the layout to this many words (0 = full layout).
    #[serde(default)]
    pub layout_tokens: usize,
}

impl Grid {
    /// Check the grid before use.
    pub fn validate(&self) -> Result<(), CoreError> {
        if !vah_generators::FAMILIES.contains(&self.family.as_str()) {
            return Err(CoreError::Invalid(format!(
                "unknown family {}",
                self.family
            )));
        }
        if self.replicates == 0 || self.replicates > MAX_SEEDS_PER_UNIT {
            return Err(CoreError::Invalid(format!(
                "replicates must be in 1..={MAX_SEEDS_PER_UNIT}"
            )));
        }
        if self.axes.is_empty() {
            return Err(CoreError::Invalid("grid has no axes".into()));
        }
        for (name, values) in &self.axes {
            if values.is_empty() {
                return Err(CoreError::Invalid(format!("axis {name} has no values")));
            }
            if values.iter().any(|v| v.is_array() || v.is_object()) {
                return Err(CoreError::Invalid(format!(
                    "axis {name} has a non-scalar value"
                )));
            }
            if self.fixed.contains_key(name) {
                return Err(CoreError::Invalid(format!(
                    "{name} is both fixed and an axis"
                )));
            }
        }
        Ok(())
    }

    /// Number of points.
    pub fn len(&self) -> usize {
        self.axes.values().map(|v| v.len()).product()
    }

    /// True when the grid has no points.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// The parameters of point `index` (row-major over the axes in name order).
    pub fn point(&self, index: usize) -> Params {
        let mut params = self.fixed.clone();
        let mut rest = index;
        // last axis varies fastest
        let axes: Vec<(&String, &Vec<Value>)> = self.axes.iter().collect();
        let mut coords = vec![0usize; axes.len()];
        for (i, (_, values)) in axes.iter().enumerate().rev() {
            coords[i] = rest % values.len();
            rest /= values.len();
        }
        for (i, (name, values)) in axes.iter().enumerate() {
            params.insert((*name).clone(), values[coords[i]].clone());
        }
        params
    }

    /// All points in order.
    pub fn points(&self) -> Vec<Params> {
        (0..self.len()).map(|i| self.point(i)).collect()
    }

    /// Index of the grid point nearest to `target` (numeric axes: nearest
    /// value; other axes: exact match required). `None` when a non-numeric
    /// axis has no matching value or an axis is missing from `target`.
    pub fn nearest(&self, target: &Params) -> Option<usize> {
        let mut index = 0usize;
        for (name, values) in &self.axes {
            let want = target.get(name)?;
            let pos = match want.as_f64() {
                Some(w) => {
                    let mut best = None::<(usize, f64)>;
                    for (i, v) in values.iter().enumerate() {
                        let x = v.as_f64()?;
                        let d = (x - w).abs();
                        if best.is_none_or(|(_, bd)| d < bd) {
                            best = Some((i, d));
                        }
                    }
                    best?.0
                }
                None => values.iter().position(|v| v == want)?,
            };
            index = index * values.len() + pos;
        }
        Some(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid() -> Grid {
        serde_json::from_str(
            r#"{"experiment_id":"t","family":"selfcite","fixed":{"window_lines":4},
                "axes":{"p_modify":[0.5,0.7,0.9],"max_len":[6,8]},"replicates":4}"#,
        )
        .unwrap()
    }

    #[test]
    fn enumerates_points_in_fixed_order() {
        let g = grid();
        g.validate().unwrap();
        assert_eq!(g.len(), 6);
        let pts = g.points();
        // axes in name order: max_len (slowest), p_modify (fastest)
        assert_eq!(pts[0]["max_len"], serde_json::json!(6));
        assert_eq!(pts[0]["p_modify"], serde_json::json!(0.5));
        assert_eq!(pts[1]["p_modify"], serde_json::json!(0.7));
        assert_eq!(pts[3]["max_len"], serde_json::json!(8));
        assert_eq!(pts[3]["p_modify"], serde_json::json!(0.5));
        assert_eq!(pts[5]["window_lines"], serde_json::json!(4));
    }

    #[test]
    fn nearest_point() {
        let g = grid();
        let mut t = Params::new();
        t.insert("p_modify".into(), serde_json::json!(0.75));
        t.insert("max_len".into(), serde_json::json!(9));
        let i = g.nearest(&t).unwrap();
        let p = g.point(i);
        assert_eq!(p["p_modify"], serde_json::json!(0.7));
        assert_eq!(p["max_len"], serde_json::json!(8));
        t.remove("max_len");
        assert_eq!(g.nearest(&t), None);
    }

    #[test]
    fn validation() {
        let mut g = grid();
        g.replicates = 0;
        assert!(g.validate().is_err());
        let mut g = grid();
        g.fixed.insert("p_modify".into(), serde_json::json!(0.1));
        assert!(g.validate().is_err());
        let mut g = grid();
        g.family = "nope".into();
        assert!(g.validate().is_err());
    }
}
