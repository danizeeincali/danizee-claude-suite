export default function ora() {
  const spinner = { start: () => spinner, stop: () => spinner, succeed: () => spinner, fail: () => spinner };
  return spinner;
}
