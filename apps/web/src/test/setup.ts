import "@testing-library/jest-dom/vitest";

function installElementPolyfill(name: string, value: unknown) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      configurable: true,
      value,
    });
  }
}

installElementPolyfill("hasPointerCapture", () => false);
installElementPolyfill("setPointerCapture", () => undefined);
installElementPolyfill("releasePointerCapture", () => undefined);
installElementPolyfill("scrollIntoView", () => undefined);

if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
