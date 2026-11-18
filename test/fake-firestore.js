// Firestore מדומה בזיכרון — לבדיקות בלבד (SHIFTS_TEST_DB=memory).
// תומך רק במה שהשרת משתמש בו: doc get/set/update/delete/create, where('==').get, select, batch, runTransaction.
import { FieldValue } from 'firebase-admin/firestore';

const DELETE = FieldValue.delete();
const isDelete = v => v && typeof v === 'object' && typeof v.isEqual === 'function' && v.isEqual(DELETE);
const clone = v => (v === undefined ? undefined : structuredClone(v));

function applyData(target, data, merge) {
  const out = merge ? { ...target } : {};
  for (const [k, v] of Object.entries(data)) {
    if (isDelete(v)) delete out[k];
    else out[k] = clone(v);
  }
  return out;
}

class Snap {
  constructor(id, data) { this.id = id; this._data = data; this.exists = data !== undefined; }
  data() { return clone(this._data); }
  get(field) { return this._data?.[field]; }
}

export class FakeDb {
  constructor() { this.store = new Map(); }
  col(name) { if (!this.store.has(name)) this.store.set(name, new Map()); return this.store.get(name); }
  collection(name) { return new Query(this, name, []); }
  batch() { return new Batch(); }
  async runTransaction(fn) {
    const tx = {
      get: ref => ref.get(),
      set: (ref, data, opts) => ref._set(data, opts),
      update: (ref, data) => ref._update(data)
    };
    return fn(tx);
  }
  reset() { this.store.clear(); }
}

class DocRef {
  constructor(db, col, id) { this.db = db; this.col = col; this.id = String(id); }
  async get() { return new Snap(this.id, clone(this.db.col(this.col).get(this.id))); }
  _set(data, opts = {}) {
    const m = this.db.col(this.col);
    m.set(this.id, applyData(m.get(this.id) || {}, data, Boolean(opts.merge)));
  }
  _update(data) {
    const m = this.db.col(this.col);
    if (!m.has(this.id)) throw new Error(`NOT_FOUND ${this.col}/${this.id}`);
    m.set(this.id, applyData(m.get(this.id), data, true));
  }
  async set(data, opts) { this._set(data, opts); }
  async update(data) { this._update(data); }
  async delete() { this.db.col(this.col).delete(this.id); }
  async create(data) {
    if (this.db.col(this.col).has(this.id)) { const e = new Error('ALREADY_EXISTS'); e.code = 6; throw e; }
    this._set(data);
  }
}

class Query {
  constructor(db, col, filters) { this.db = db; this.name = col; this.filters = filters; }
  doc(id) { return new DocRef(this.db, this.name, id ?? Math.random().toString(36).slice(2)); }
  where(field, op, value) {
    if (op !== '==') throw new Error('fake supports == only');
    return new Query(this.db, this.name, [...this.filters, [field, value]]);
  }
  select() { return this; }
  async get() {
    const docs = [...this.db.col(this.name).entries()]
      .filter(([, d]) => this.filters.every(([f, v]) => d[f] === v))
      .map(([id, d]) => new Snap(id, clone(d)));
    return { docs, size: docs.length, forEach: fn => docs.forEach(fn), empty: docs.length === 0 };
  }
}

class Batch {
  constructor() { this.ops = []; }
  set(ref, data, opts) { this.ops.push(() => ref._set(data, opts)); }
  update(ref, data) { this.ops.push(() => ref._update(data)); }
  delete(ref) { this.ops.push(() => ref.db.col(ref.col).delete(ref.id)); }
  async commit() {
    if (this.ops.length > 500) throw new Error('batch > 500 ops');
    this.ops.forEach(op => op());
  }
}

export const db = new FakeDb();
