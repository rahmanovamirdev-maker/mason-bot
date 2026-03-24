import { BotChartPoint } from "./types.js";

function createDataset(label: string, color: string, data: number[]) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}33`,
    borderWidth: 3,
    tension: 0.35,
    fill: false,
    pointRadius: 4,
    pointHoverRadius: 5
  };
}

export async function generateBotStatsChart(points: BotChartPoint[], title: string): Promise<Buffer> {
  const maxValue = Math.max(
    0,
    ...points.flatMap((point) => [point.created, point.approved, point.registration])
  );
  const yAxisMax = Math.max(5, maxValue + 1);

  const chartConfig = {
    type: "line",
    data: {
      labels: points.map((point) => point.label),
      datasets: [
        createDataset("Новые анкеты", "#2D8CFF", points.map((point) => point.created)),
        createDataset("Одобренные", "#FF9F1A", points.map((point) => point.approved)),
        createDataset("Регистрация", "#22C55E", points.map((point) => point.registration))
      ]
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: title,
          color: "#F3F4F6",
          font: {
            size: 20
          }
        },
        legend: {
          labels: {
            color: "#E5E7EB"
          }
        }
      },
      scales: {
        x: {
          ticks: {
            color: "#D1D5DB"
          },
          grid: {
            color: "rgba(255, 255, 255, 0.08)"
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          max: yAxisMax,
          ticks: {
            color: "#D1D5DB",
            precision: 0,
            stepSize: 1
          },
          grid: {
            color: "rgba(255, 255, 255, 0.08)"
          }
        }
      },
      layout: {
        padding: 16
      }
    }
  };

  const response = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      backgroundColor: "#111827",
      width: 1200,
      height: 700,
      format: "png",
      chart: chartConfig
    })
  });

  if (!response.ok) {
    throw new Error(`QuickChart request failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}