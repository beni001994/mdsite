/** An error whose message is meant to be shown to the user as-is. */
export class MdsiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MdsiteError';
  }
}

export class FrontMatterError extends MdsiteError {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(`front matter line ${line}: ${message}`);
    this.name = 'FrontMatterError';
  }
}

export class TemplateError extends MdsiteError {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}
