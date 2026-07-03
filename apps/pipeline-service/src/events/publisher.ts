import { PubSub } from "@google-cloud/pubsub";
import type { Config } from "../config.js";
import { log } from "../lib/logger.js";

export interface CallTranscribedEvent {
  callId: string;
}

export interface EventPublisher {
  /** Stage transition: transcript persisted → schedule AI scoring. */
  callTranscribed(event: CallTranscribedEvent): Promise<void>;
}

/**
 * Production transport: each stage transition is its own Pub/Sub message,
 * so scoring gets independent retry/backoff and a dead-letter queue. An
 * Anthropic outage delays scoring; it never loses calls.
 */
export function pubsubPublisher(config: Config): EventPublisher {
  const pubsub = new PubSub();
  const topic = pubsub.topic(config.PUBSUB_TOPIC_TRANSCRIBED);
  return {
    async callTranscribed(event) {
      await topic.publishMessage({ json: event });
      log.info("published call-transcribed", { callId: event.callId });
    },
  };
}

/** Local/dev transport: invokes the next stage in-process. */
export function inlinePublisher(handler: (e: CallTranscribedEvent) => Promise<void>): EventPublisher {
  return {
    async callTranscribed(event) {
      // Deliberately not awaited by the webhook response path; failures are
      // recorded by the handler itself like any other stage failure.
      handler(event).catch((err) => {
        log.error("inline scoring failed", { callId: event.callId, error: String(err) });
      });
    },
  };
}
