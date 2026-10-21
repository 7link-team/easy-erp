//! Runtime fonts only: no font bytes are included in the executable.
use crate::error::{ApiError, Result};
use krilla::{
    Document,
    geom::Point,
    page::PageSettings,
    text::{Font, TextDirection},
};
use std::path::PathBuf;

fn font_error(detail: &str) -> ApiError {
    ApiError::bad(format!(
        "无法生成中文 PDF：{detail}。请安装 Noto Sans CJK、微软雅黑或文泉驿中文字体，或将 ERP_REPORT_FONT 指向可用的 TTF/OTF/TTC 字体文件；也可改用 Excel。"
    ))
}
fn candidates() -> Vec<PathBuf> {
    if let Some(path) = std::env::var_os("ERP_REPORT_FONT") {
        // An explicit override must not silently fall back to another font.
        return vec![path.into()];
    }
    let mut paths = Vec::new();
    if cfg!(target_os = "windows") {
        let windows = std::env::var_os("WINDIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:/Windows"));
        for name in ["msyh.ttc", "msyh.ttf", "simhei.ttf"] {
            paths.push(windows.join("Fonts").join(name));
        }
    } else if cfg!(target_os = "macos") {
        paths.extend(
            [
                "/System/Library/Fonts/PingFang.ttc",
                "/System/Library/Fonts/Supplemental/PingFang.ttc",
                "/System/Library/Fonts/Hiragino Sans GB.ttc",
                "/System/Library/Fonts/STHeiti Light.ttc",
                "/Library/Fonts/NotoSansCJK-Regular.ttc",
            ]
            .map(PathBuf::from),
        );
    } else {
        paths.extend(
            [
                "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc",
                "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
                "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
                "/usr/share/fonts/wqy-microhei/wqy-microhei.ttc",
                "/usr/local/share/fonts/NotoSansCJK-Regular.ttc",
            ]
            .map(PathBuf::from),
        );
    }
    paths
}
fn load_font(paths: &[PathBuf], text: &str) -> Result<(Vec<u8>, u32)> {
    for path in paths {
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        for index in 0..ttf_parser::fonts_in_collection(&bytes).unwrap_or(1) {
            let Ok(face) = ttf_parser::Face::parse(&bytes, index) else {
                continue;
            };
            // Check actual user data as well as Chinese, before rendering any PDF.
            if "中文报告"
                .chars()
                .chain(text.chars())
                .filter(|c| !c.is_control())
                .all(|c| face.glyph_index(c).is_some_and(|id| id.0 != 0))
                && Font::new(bytes.clone().into(), index).is_some()
            {
                return Ok((bytes, index));
            }
        }
    }
    Err(font_error(
        "未找到能显示本报告全部字符的可读中文字体（字体可能不存在、损坏或缺字）",
    ))
}

pub(crate) fn render(rows: &[Vec<String>]) -> Result<Vec<u8>> {
    render_with_fonts(rows, &candidates())
}
fn render_with_fonts(rows: &[Vec<String>], paths: &[PathBuf]) -> Result<Vec<u8>> {
    // All cells are retained, including long names. Wrapping and pagination never truncate data.
    let paragraphs = rows
        .iter()
        .map(|row| {
            row.join(" | ")
                .chars()
                .map(|c| if c.is_control() { ' ' } else { c })
                .collect::<String>()
        })
        .collect::<Vec<_>>();
    let text = paragraphs.join("\n");
    let (bytes, index) = load_font(paths, &text)?;
    let face = ttf_parser::Face::parse(&bytes, index).map_err(|_| font_error("字体无法解析"))?;
    let font =
        Font::new(bytes.clone().into(), index).ok_or_else(|| font_error("字体格式不受支持"))?;
    const FONT_SIZE: f32 = 11.0;
    const LINE_WIDTH: f32 = 515.0;
    let mut lines = Vec::new();
    for paragraph in paragraphs {
        let mut line = String::new();
        let mut width = 0.0;
        for ch in paragraph.chars() {
            let glyph = face
                .glyph_index(ch)
                .ok_or_else(|| font_error("字体缺少报告中的字符"))?;
            let advance = face.glyph_hor_advance(glyph).unwrap_or(face.units_per_em()) as f32
                / face.units_per_em() as f32
                * FONT_SIZE;
            if width + advance > LINE_WIDTH && !line.is_empty() {
                lines.push(std::mem::take(&mut line));
                width = 0.0;
            }
            line.push(ch);
            width += advance;
        }
        lines.push(line);
    }
    let mut document = Document::new();
    for chunk in lines.chunks(42) {
        let mut page = document.start_page_with(PageSettings::from_wh(595.0, 842.0).unwrap());
        let mut surface = page.surface();
        for (index, line) in chunk.iter().enumerate() {
            surface.draw_text(
                Point::from_xy(40.0, 50.0 + index as f32 * 18.0),
                font.clone(),
                FONT_SIZE,
                line,
                false,
                TextDirection::LeftToRight,
            );
        }
        surface.finish();
        page.finish();
    }
    document.finish().map_err(|e| {
        tracing::error!(?e, "报告 PDF 字体嵌入或生成失败");
        font_error("字体嵌入或文件生成失败")
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unavailable_or_invalid_fonts_fail_actionably() {
        for paths in [vec![], vec![PathBuf::from("/nonexistent/report-font.ttf")]] {
            let err = render_with_fonts(&[vec!["中文物料".into()]], &paths).unwrap_err();
            assert!(err.1.contains("ERP_REPORT_FONT"));
            assert!(err.1.contains("Excel"));
        }
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(file.path(), b"not a font").unwrap();
        assert!(load_font(&[file.path().to_owned()], "中文").is_err());
    }

    /// Reports what this platform actually has, on every platform, so the
    /// per-OS candidate list is checked by CI rather than by whoever happens to
    /// develop on a Mac. Not an assertion: a stripped Linux container with no
    /// CJK font installed is a fact about that container, and the product
    /// answers it with an actionable error — but the log has to say so, or the
    /// list quietly rots.
    #[test]
    fn report_which_chinese_font_this_platform_offers() {
        let found = candidates().into_iter().find(|path| path.exists());
        match &found {
            Some(path) => eprintln!("本平台可用中文字体：{}", path.display()),
            None => eprintln!(
                "本平台未找到中文字体，候选为 {:?}。PDF 报告会返回可操作错误，\
                 需要装一个中文字体或设置 ERP_REPORT_FONT。",
                candidates()
            ),
        }
        // Whatever it found must at least be loadable for the characters a
        // report actually emits; a candidate that exists but cannot render
        // Chinese is worse than none, because it looks configured.
        if let Some(path) = found {
            let probe = load_font(&[path.clone()], "库存日报物料");
            assert!(
                probe.is_ok(),
                "候选字体 {} 存在但无法渲染中文，候选表需要修正",
                path.display()
            );
        }
    }

    /// Explicitly invoked verification: requires an installed font, exports a real artifact.
    #[test]
    #[ignore = "requires a runtime CJK font; run explicitly with ERP_REPORT_PDF_EVIDENCE"]
    fn chinese_pdf_evidence() {
        let mut rows = vec![
            vec!["日报 中文物料 螺丝 客户收入 库存总成本 未定价".into()],
            vec!["入库总额 123.45 出库总额 67.89".into()],
        ];
        rows.extend(
            (0..100).map(|i| vec![format!("第{i}项物料：不锈钢螺丝 ABC-123，客户上海工厂")]),
        );
        let pdf = render(&rows).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        // Say so rather than panicking with a message only its author can
        // read: this writes a file for a person to look at, and a run without
        // somewhere to put it has still checked everything above.
        match std::env::var_os("ERP_REPORT_PDF_EVIDENCE") {
            Some(path) => std::fs::write(path, pdf).unwrap(),
            None => eprintln!(
                "未写出 PDF 样本：设置 ERP_REPORT_PDF_EVIDENCE=<路径> 可生成一份供人工核对。"
            ),
        }
        // A valid CJK font must still reject unsupported user characters.
        assert!(load_font(&candidates(), "\u{10ffff}").is_err());
    }
}
