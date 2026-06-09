"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi
} from "lightweight-charts";
import type { PaperBotSnapshot } from "../../lib/paperBotApi";

type Props = {
  snapshots: PaperBotSnapshot[];
  height?: number;
};

export function BotPerformanceChart({ snapshots, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "rgba(226,232,240,0.75)"
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.06)" },
        horzLines: { color: "rgba(255,255,255,0.06)" }
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.08)" },
      timeScale: { borderColor: "rgba(255,255,255,0.08)" }
    });

    const series = chart.addSeries(LineSeries, {
      color: "#a78bfa",
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;
    const data = snapshots.map((s) => ({
      time: s.snapshotDate,
      value: s.equityUsd
    }));
    seriesRef.current.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [snapshots]);

  if (!snapshots.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl border border-dashed border-white/10 bg-black/30 px-4 text-center"
        style={{ height }}
      >
        <p className="text-xs text-white/50">
          Equity curve appears after your first simulated fill or run-day snapshot.
        </p>
      </div>
    );
  }

  return <div ref={containerRef} className="w-full rounded-xl border border-white/10 bg-black/30" />;
}
