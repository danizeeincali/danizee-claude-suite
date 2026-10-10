/** An error that carries the kit CLI's exit code: 1 invalid input or broken state, 2 policy refusal. */
export class KitExit extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}
