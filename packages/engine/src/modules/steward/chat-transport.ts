import type { DeliveryAdapter } from "@chrona/contracts/steward";
import type { StewardService } from "./service";

/** Transport lifecycle owned by the host runtime. */
export type StewardChatTransport = {
  delivery: DeliveryAdapter; bound(): Promise<boolean>;
  start(service: StewardService, wake: () => void): Promise<void>; stop(): Promise<void>;
};
