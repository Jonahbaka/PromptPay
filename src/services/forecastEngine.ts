// ═══════════════════════════════════════════════════════════════
// PromptPay :: Forecast Engine
// Statistical forecasting: moving averages, exponential smoothing,
// linear regression, confidence intervals
// ═══════════════════════════════════════════════════════════════

export interface ForecastPoint {
  period: string;
  value: number;
  lower: number;  // confidence interval lower
  upper: number;  // confidence interval upper
  isForecast: boolean;
}

export interface ForecastResult {
  historical: ForecastPoint[];
  forecast: ForecastPoint[];
  accuracy: number;       // 0-100 score
  method: string;
  trend: 'up' | 'down' | 'stable';
  growthRate: number;     // % change expected
}

export class ForecastEngine {

  // ── Generate forecast from a time series ──
  generateForecast(
    data: Array<{ period: string; value: number }>,
    horizonDays: number = 30,
    confidenceLevel: number = 0.95
  ): ForecastResult {
    if (data.length < 3) {
      return this.emptyForecast(data, horizonDays);
    }

    const values = data.map(d => d.value);

    // Choose best method
    const maForecast = this.movingAverage(values, Math.min(7, Math.floor(values.length / 2)));
    const esForecast = this.exponentialSmoothing(values, 0.3);
    const lrForecast = this.linearRegression(values);

    // Pick method with lowest MAE on last 20% of data
    const testSize = Math.max(3, Math.floor(values.length * 0.2));
    const trainValues = values.slice(0, -testSize);
    const testValues = values.slice(-testSize);

    const methods = [
      { name: 'Moving Average', fn: () => this.movingAverage(trainValues, Math.min(7, Math.floor(trainValues.length / 2))), forecast: maForecast },
      { name: 'Exponential Smoothing', fn: () => this.exponentialSmoothing(trainValues, 0.3), forecast: esForecast },
      { name: 'Linear Regression', fn: () => this.linearRegression(trainValues), forecast: lrForecast },
    ];

    let bestMethod = methods[0];
    let bestMAE = Infinity;

    for (const m of methods) {
      const predicted = m.fn();
      const nextN = this.projectForward(predicted, testSize);
      const mae = this.meanAbsoluteError(testValues, nextN);
      if (mae < bestMAE) {
        bestMAE = mae;
        bestMethod = m;
      }
    }

    // Generate forecast points
    const projected = this.projectForward(bestMethod.forecast, horizonDays);
    const stdDev = this.standardDeviation(values);
    const zScore = confidenceLevel >= 0.99 ? 2.576 : confidenceLevel >= 0.95 ? 1.96 : 1.645;

    const historical: ForecastPoint[] = data.map((d, i) => ({
      period: d.period,
      value: Math.round(d.value * 100) / 100,
      lower: Math.round(d.value * 100) / 100,
      upper: Math.round(d.value * 100) / 100,
      isForecast: false,
    }));

    const lastDate = new Date(data[data.length - 1].period);
    const forecast: ForecastPoint[] = projected.map((v, i) => {
      const d = new Date(lastDate);
      d.setDate(d.getDate() + i + 1);
      const margin = stdDev * zScore * Math.sqrt(1 + (i + 1) / values.length);
      return {
        period: d.toISOString().split('T')[0],
        value: Math.round(Math.max(0, v) * 100) / 100,
        lower: Math.round(Math.max(0, v - margin) * 100) / 100,
        upper: Math.round((v + margin) * 100) / 100,
        isForecast: true,
      };
    });

    // Accuracy = 100 - normalized MAE
    const meanVal = values.reduce((s, v) => s + v, 0) / values.length;
    const accuracy = meanVal > 0 ? Math.round(Math.max(0, Math.min(100, 100 - (bestMAE / meanVal) * 100))) : 50;

    // Trend detection
    const last = values.slice(-Math.min(7, values.length));
    const firstHalf = last.slice(0, Math.floor(last.length / 2));
    const secondHalf = last.slice(Math.floor(last.length / 2));
    const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
    const growthRate = avgFirst > 0 ? Math.round(((avgSecond - avgFirst) / avgFirst) * 10000) / 100 : 0;

    return {
      historical,
      forecast,
      accuracy,
      method: bestMethod.name,
      trend: growthRate > 3 ? 'up' : growthRate < -3 ? 'down' : 'stable',
      growthRate,
    };
  }

  // ── Moving Average ──
  private movingAverage(values: number[], window: number): number[] {
    if (window < 1) window = 1;
    const result: number[] = [];
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - window + 1);
      const slice = values.slice(start, i + 1);
      result.push(slice.reduce((s, v) => s + v, 0) / slice.length);
    }
    return result;
  }

  // ── Exponential Smoothing (Simple) ──
  private exponentialSmoothing(values: number[], alpha: number): number[] {
    const result: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
    }
    return result;
  }

  // ── Linear Regression ──
  private linearRegression(values: number[]): number[] {
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += values[i];
      sumXY += i * values[i]; sumX2 += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return values.map((_, i) => slope * i + intercept);
  }

  // ── Project forward from smoothed values ──
  private projectForward(smoothed: number[], horizon: number): number[] {
    if (smoothed.length < 2) {
      const lastVal = smoothed[smoothed.length - 1] || 0;
      return Array(horizon).fill(lastVal);
    }

    // Use last few points trend
    const tail = smoothed.slice(-Math.min(7, smoothed.length));
    const n = tail.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let i = 0; i < n; i++) {
      sumX += i; sumY += tail[i];
      sumXY += i * tail[i]; sumX2 += i * i;
    }
    const denom = n * sumX2 - sumX * sumX;
    const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
    const intercept = (sumY - slope * sumX) / n;
    const lastIdx = n - 1;

    return Array.from({ length: horizon }, (_, i) =>
      slope * (lastIdx + i + 1) + intercept
    );
  }

  // ── Helpers ──
  private meanAbsoluteError(actual: number[], predicted: number[]): number {
    const len = Math.min(actual.length, predicted.length);
    if (len === 0) return Infinity;
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Math.abs(actual[i] - predicted[i]);
    return sum / len;
  }

  private standardDeviation(values: number[]): number {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private emptyForecast(data: Array<{ period: string; value: number }>, horizon: number): ForecastResult {
    const lastVal = data.length > 0 ? data[data.length - 1].value : 0;
    const lastDate = data.length > 0 ? new Date(data[data.length - 1].period) : new Date();
    return {
      historical: data.map(d => ({ ...d, lower: d.value, upper: d.value, isForecast: false })),
      forecast: Array.from({ length: horizon }, (_, i) => {
        const d = new Date(lastDate); d.setDate(d.getDate() + i + 1);
        return { period: d.toISOString().split('T')[0], value: lastVal, lower: 0, upper: lastVal * 2, isForecast: true };
      }),
      accuracy: 0,
      method: 'Insufficient Data',
      trend: 'stable',
      growthRate: 0,
    };
  }
}
