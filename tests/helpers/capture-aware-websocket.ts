/**
 * A `sendCommandToFigma` mock that still honours CAPTURE MODE.
 *
 * `batch_actions` builds each action's payload by running the standalone tool handler
 * with `sendCommandToFigma` intercepted (see `utils/tool-capture.ts`). A test that
 * replaces the whole websocket module would swallow that interception and every batch
 * would come out empty — so the mock consults the capture context first and only falls
 * through to the underlying jest mock for REAL dispatches.
 *
 * It is a Proxy over an ordinary `jest.fn()`, so `.mock`, `mockResolvedValue`,
 * `toHaveBeenCalledTimes` and friends all behave exactly as a test expects — and they
 * see real dispatches only. A captured command was never put on the wire, so a test
 * asserting on the wire must not see it.
 */
import { interceptForCapture } from "../../src/videntia_figma_mcp/utils/tool-capture";

export function createCaptureAwareSend(): jest.Mock {
  const inner = jest.fn();
  return new Proxy(inner, {
    apply(target, thisArg, args: unknown[]) {
      const captured = interceptForCapture(args[0] as string, args[1]);
      if (captured) return Promise.resolve(captured.value);
      return Reflect.apply(target, thisArg, args);
    },
    get(target, prop) {
      // bun's mock accessors brand-check `this`, which a Proxy receiver fails — read and
      // bind against the real mock.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as jest.Mock;
}
