export default function sum(values: number[]): number {
  return values.reduce((acc, n) => acc + n, 0);
}

export function avg(values: number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}
