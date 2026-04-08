import { flag, logStartup } from "./effects";

if (flag) {
  logStartup("boot");
}

for (let i = 0; i < 1; i += 1) {
  logStartup(`loop:${i}`);
}
