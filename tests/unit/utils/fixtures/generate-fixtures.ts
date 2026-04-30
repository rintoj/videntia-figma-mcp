import { PNG } from "pngjs";
import * as fs from "fs";

function solidPng(r: number, g: number, b: number, file: string) {
  const png = new PNG({ width: 10, height: 10 });
  for (let i = 0; i < 10 * 10; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}

solidPng(255, 0, 0, "tests/unit/utils/fixtures/red-10x10.png");
solidPng(0, 0, 255, "tests/unit/utils/fixtures/blue-10x10.png");
console.log("fixtures created");
