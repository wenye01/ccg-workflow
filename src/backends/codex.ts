import { AbstractBaseAdapter, type BaseAdapterOptions } from './base'

export class CodexAdapter extends AbstractBaseAdapter {
  name = 'codex'
  capabilities = {
    supports_session: true,
    supports_structured_output: true,
    supports_streaming: false,
  }

  constructor(options: BaseAdapterOptions = {}) {
    super(options)
  }
}

