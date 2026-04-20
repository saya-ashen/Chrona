import { describe, expect, it } from "vitest";

import {
  buildGifCommands,
  createDemoArtifactPaths,
  findRecordedVideo,
} from "@/lib/demo-artifacts";

describe("createDemoArtifactPaths", () => {
  it("returns stable repository-relative locations for README demo artifacts", () => {
    expect(createDemoArtifactPaths("/repo")).toEqual({
      artifactsDir: "/repo/artifacts/demo",
      playwrightOutputDir: "/repo/artifacts/demo/playwright",
      palettePath: "/repo/artifacts/demo/chrona-readme-demo.palette.png",
      gifPath: "/repo/docs/assets/demo/chrona-readme-demo.gif",
    });
  });
});

describe("buildGifCommands", () => {
  it("builds the palette and gif ffmpeg commands with consistent filters", () => {
    const commands = buildGifCommands({
      inputVideoPath: "/repo/artifacts/demo/input.webm",
      palettePath: "/repo/artifacts/demo/palette.png",
      outputGifPath: "/repo/docs/assets/demo/demo.gif",
      width: 1280,
      fps: 12,
    });

    expect(commands).toEqual({
      palette: [
        "ffmpeg",
        "-y",
        "-i",
        "/repo/artifacts/demo/input.webm",
        "-vf",
        "fps=12,scale=1280:-1:flags=lanczos,palettegen",
        "/repo/artifacts/demo/palette.png",
      ],
      gif: [
        "ffmpeg",
        "-y",
        "-i",
        "/repo/artifacts/demo/input.webm",
        "-i",
        "/repo/artifacts/demo/palette.png",
        "-filter_complex",
        "fps=12,scale=1280:-1:flags=lanczos[x];[x][1:v]paletteuse",
        "/repo/docs/assets/demo/demo.gif",
      ],
    });
  });
});

describe("findRecordedVideo", () => {
  it("returns the single recorded video when exactly one webm exists", () => {
    expect(
      findRecordedVideo([
        "/repo/artifacts/demo/playwright/test-results.json",
        "/repo/artifacts/demo/playwright/chromium/video.webm",
      ]),
    ).toBe("/repo/artifacts/demo/playwright/chromium/video.webm");
  });

  it("throws a helpful error when no recorded video is present", () => {
    expect(() => findRecordedVideo([])).toThrowError(/No Playwright video found/);
  });

  it("throws a helpful error when multiple recorded videos are present", () => {
    expect(() =>
      findRecordedVideo([
        "/repo/artifacts/demo/playwright/a/video.webm",
        "/repo/artifacts/demo/playwright/b/video.webm",
      ]),
    ).toThrowError(/Expected exactly one Playwright video/);
  });
});
