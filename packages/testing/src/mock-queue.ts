/** Queue send options recorded by `createMockQueue()`. */
export type MockQueueSendOptions = {
  contentType?: string;
  delaySeconds?: number;
};

/** Recorded queue message. */
export type MockQueueMessage<Message> = {
  message: Message;
  options?: MockQueueSendOptions;
};

/** In-memory Queue binding mock with inspectable sent messages. */
export type MockQueue<Message> = {
  readonly messages: MockQueueMessage<Message>[];
  send(message: Message, options?: MockQueueSendOptions): Promise<void>;
  clear(): void;
};

/** Create an in-memory Queue binding mock for tests. */
export function createMockQueue<Message>(): MockQueue<Message> {
  const messages: MockQueueMessage<Message>[] = [];
  return {
    messages,
    async send(message, options) {
      messages.push(options ? { message, options } : { message });
    },
    clear() {
      messages.splice(0, messages.length);
    },
  };
}
