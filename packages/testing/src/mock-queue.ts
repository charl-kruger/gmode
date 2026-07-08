export type MockQueueSendOptions = {
  contentType?: string;
  delaySeconds?: number;
};

export type MockQueueMessage<Message> = {
  message: Message;
  options?: MockQueueSendOptions;
};

export type MockQueue<Message> = {
  readonly messages: MockQueueMessage<Message>[];
  send(message: Message, options?: MockQueueSendOptions): Promise<void>;
  clear(): void;
};

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
