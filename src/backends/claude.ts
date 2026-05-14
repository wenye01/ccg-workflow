import { AbstractBaseAdapter, type BaseAdapterOptions } from './base'

export class ClaudeAdapter extends AbstractBaseAdapter {
  name = 'claude'
  capabilities = {
    supports_session: true,
    supports_structured_output: true,
    supports_streaming: false,
  }

  constructor(options: BaseAdapterOptions = {}) {
    super(options)
  }
}

