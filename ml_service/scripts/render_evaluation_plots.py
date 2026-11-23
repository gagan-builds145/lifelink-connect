"""Render actual-vs-predicted demand SVG without matplotlib.

Reads the bounded holdout sample saved in demand_metadata.json. The plot is
documentation only; it does not change model metrics or inference.
"""

from __future__ import annotations

import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
METADATA = ROOT / "artifacts" / "demand_metadata.json"
OUTPUT = ROOT / "artifacts" / "demand-actual-vs-predicted.svg"


def main() -> int:
    metadata = json.loads(METADATA.read_text(encoding="utf-8"))
    plot = metadata.get("evaluation_plot") or {}
    actual = plot.get("actual") or []
    predicted = plot.get("predicted") or []
    baseline = plot.get("baseline") or []
    if not actual or len(actual) != len(predicted):
        raise SystemExit("No saved holdout plot data. Retrain the demand model first.")

    width, height, left, right, top, bottom = 960, 420, 64, 24, 36, 56
    all_values = actual + predicted + baseline
    low, high = 0.0, max(1.0, max(all_values) * 1.1)
    span = high - low
    plot_width = width - left - right
    plot_height = height - top - bottom

    def points(values: list[float]) -> str:
        return " ".join(
            f"{left + (index / max(1, len(values) - 1)) * plot_width:.1f},"
            f"{top + plot_height - ((value - low) / span) * plot_height:.1f}"
            for index, value in enumerate(values)
        )

    doctor = metadata.get("dataset_label", "unknown dataset")
    version = metadata.get("version", "unknown")
    metrics = metadata.get("metrics", {})
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="100%" height="100%" fill="#fffdf8"/>
  <text x="{left}" y="22" font-family="sans-serif" font-size="16" font-weight="700" fill="#1f2937">XGBoost demand — actual vs predicted (chronological holdout sample)</text>
  <text x="{left}" y="42" font-family="sans-serif" font-size="10" fill="#6b7280">{escape(str(version))} · MAE {metrics.get('mae')} · RMSE {metrics.get('rmse')} · baseline MAE {metrics.get('baseline_mae')}</text>
  <line x1="{left}" y1="{top + plot_height}" x2="{width - right}" y2="{top + plot_height}" stroke="#9ca3af"/>
  <line x1="{left}" y1="{top}" x2="{left}" y2="{top + plot_height}" stroke="#9ca3af"/>
  <polyline fill="none" stroke="#b91c1c" stroke-width="2" points="{points(actual)}"/>
  <polyline fill="none" stroke="#0f766e" stroke-width="2" points="{points(predicted)}"/>
  <polyline fill="none" stroke="#9ca3af" stroke-width="1.5" stroke-dasharray="4 4" points="{points(baseline)}"/>
  <text x="{left}" y="{height - 22}" font-family="sans-serif" font-size="10" fill="#6b7280">Red: actual · Teal: XGBoost · Grey dashed: rolling baseline. Smoothed synthetic held-out demand, not clinical performance.</text>
  <text x="{width - right}" y="{height - 22}" text-anchor="end" font-family="sans-serif" font-size="9" fill="#6b7280">{escape(str(doctor))[:110]}</text>
</svg>
"""
    OUTPUT.write_text(svg, encoding="utf-8")
    print(OUTPUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
