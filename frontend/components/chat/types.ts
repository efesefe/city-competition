export type ChatThreadMessage = {
  id: string;
  tribeId: string;
  senderId: string;
  body: string;
  createdAt: string;
  /** Local-only: flagged & withheld from tribe broadcast. */
  underReview?: boolean;
};
