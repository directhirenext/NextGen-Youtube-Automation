import { EventEmitter } from 'events';

class SystemLogger extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxLogs = 200;
  }

  _record(level, moduleName, message, meta = {}) {
    const entry = {
      id: Date.now() + Math.random().toString(36).substring(2, 7),
      timestamp: new Date().toISOString(),
      level,
      module: moduleName,
      message,
      meta
    };
    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) this.logs.pop();
    
    const icon = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : level === 'SUCCESS' ? '✅' : 'ℹ️';
    console.log(`${icon} [${entry.timestamp}] [${moduleName}] ${message}`);
    this.emit('log', entry);
    return entry;
  }

  info(moduleName, message, meta) { return this._record('INFO', moduleName, message, meta); }
  success(moduleName, message, meta) { return this._record('SUCCESS', moduleName, message, meta); }
  warn(moduleName, message, meta) { return this._record('WARN', moduleName, message, meta); }
  error(moduleName, message, meta) { return this._record('ERROR', moduleName, message, meta); }

  getRecentLogs(limit = 50) {
    return this.logs.slice(0, limit);
  }
}

export const logger = new SystemLogger();
