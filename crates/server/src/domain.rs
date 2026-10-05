//! Pure inventory rules. No HTTP, ORM, filesystem, or desktop dependencies.
use crate::error::{ApiError, Result};

pub const SCALE: i64 = 1000;
pub const MAX_QUANTITY: i64 = 999_999_999_999;
pub const ITEM_KINDS: [&str; 5] = ["原材料", "半成品", "成品", "辅料耗材", "其他"];

/// Parse a user's decimal text exactly, with no floating point or silent rounding.
pub fn quantity(input: &str, precision: i64, allow_zero: bool) -> Result<i64> {
    let value = input.trim();
    if !(0..=3).contains(&precision) || value.is_empty() || value.len() > 16 {
        return Err(ApiError::bad("请输入有效数量。"));
    }
    let mut parts = value.split('.');
    let whole = parts.next().unwrap();
    let decimal = parts.next().unwrap_or("");
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|c| c.is_ascii_digit())
        || !decimal.bytes().all(|c| c.is_ascii_digit())
        || (value.contains('.') && decimal.is_empty())
    {
        return Err(ApiError::bad(
            "数量请填写数字，不要填写负数、逗号或算式，例如请填 1000，不要填 1,000 或 1e3。",
        ));
    }
    if decimal.len() > precision as usize {
        return Err(ApiError::bad(if precision == 0 {
            "这件物料只能填写整数。".into()
        } else {
            format!("这件物料最多填写 {precision} 位小数。")
        }));
    }
    let integer = whole.parse::<i64>().ok().and_then(|x| x.checked_mul(SCALE));
    let fraction = if decimal.is_empty() {
        0
    } else {
        decimal.parse::<i64>().unwrap() * 10i64.pow(3 - decimal.len() as u32)
    };
    let scaled = integer
        .and_then(|x| x.checked_add(fraction))
        .filter(|x| *x <= MAX_QUANTITY)
        .ok_or_else(|| ApiError::bad("数量过大，最大支持 999999999.999。"))?;
    if !allow_zero && scaled == 0 {
        return Err(ApiError::bad("入库或出库数量必须大于 0。"));
    }
    Ok(scaled)
}
pub fn display(value: i64, precision: i64) -> String {
    let whole = value / SCALE;
    let fraction = (value % SCALE).abs();
    if precision == 0 {
        whole.to_string()
    } else {
        format!(
            "{whole}.{:0width$}",
            fraction / 10i64.pow(3 - precision as u32),
            width = precision as usize
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MovementKind {
    Receipt,
    Finished,
    ReturnIn,
    Issue,
    Shipment,
    ReturnOut,
    Scrap,
    Opening,
}
impl MovementKind {
    pub fn parse(value: &str) -> Result<Self> {
        match value {
            "receipt" => Ok(Self::Receipt),
            "finished" => Ok(Self::Finished),
            "return_in" => Ok(Self::ReturnIn),
            "issue" => Ok(Self::Issue),
            "shipment" => Ok(Self::Shipment),
            "return_out" => Ok(Self::ReturnOut),
            "scrap" => Ok(Self::Scrap),
            "opening" => Ok(Self::Opening),
            _ => Err(ApiError::bad("请选择正确的入库或出库用途。")),
        }
    }
    pub fn incoming(self) -> bool {
        matches!(
            self,
            Self::Receipt | Self::Finished | Self::ReturnIn | Self::Opening
        )
    }
    pub fn admin_only(self) -> bool {
        matches!(self, Self::Scrap | Self::Opening)
    }
    pub fn label(self) -> &'static str {
        match self {
            Self::Receipt => "收货入库",
            Self::Finished => "完工入库",
            Self::ReturnIn => "退回入库",
            Self::Issue => "领用出库",
            Self::Shipment => "发货出库",
            Self::ReturnOut => "退回供应方",
            Self::Scrap => "报损出库",
            Self::Opening => "首次登记库存",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_quantities() {
        assert_eq!(quantity("1.250", 3, false).unwrap(), 1250);
        assert_eq!(quantity("0", 0, true).unwrap(), 0);
        assert_eq!(display(1250, 3), "1.250");
    }
    #[test]
    fn rejects_ambiguous_and_invalid_values() {
        for x in [
            "",
            "-1",
            "1e3",
            "1,000",
            "1.",
            ".5",
            "1.0001",
            "999999999999999999",
            "NaN",
        ] {
            assert!(quantity(x, 3, false).is_err(), "{x}");
        }
        assert!(quantity("1.2", 0, false).is_err());
        assert!(quantity("0", 3, false).is_err());
    }
}
