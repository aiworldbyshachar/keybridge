'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = ['state:changed', 'recorded', 'account:code', 'toast', 'ui:open-settings', 'ui:new-shortcut'];

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  getState: () => ipcRenderer.invoke('state:get'),
  saveShortcut: (fields) => ipcRenderer.invoke('shortcut:save', fields),
  removeShortcut: (id) => ipcRenderer.invoke('shortcut:remove', id),
  duplicateShortcut: (id) => ipcRenderer.invoke('shortcut:duplicate', id),
  enableShortcut: (id, on) => ipcRenderer.invoke('shortcut:enable', id, on),
  checkTrigger: (trigger, id, scope) => ipcRenderer.invoke('trigger:check', trigger, id, scope),
  record: (on) => ipcRenderer.invoke('record', on),
  saveGroup: (fields) => ipcRenderer.invoke('group:save', fields),
  removeGroup: (id) => ipcRenderer.invoke('group:remove', id),
  trash: () => ipcRenderer.invoke('trash:list'),
  restore: (id) => ipcRenderer.invoke('trash:restore', id),
  forget: (id) => ipcRenderer.invoke('trash:forget', id),
  choosePath: (what) => ipcRenderer.invoke('path:choose', what),
  importClavier: () => ipcRenderer.invoke('import:clavier'),
  importJson: () => ipcRenderer.invoke('import:json'),
  exportJson: () => ipcRenderer.invoke('export:json'),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  signIn: (email) => ipcRenderer.invoke('account:signin', email),
  enterEmailCode: (code) => ipcRenderer.invoke('account:email-code', code),
  cancelSignIn: () => ipcRenderer.invoke('account:cancel'),
  enterCode: (code) => ipcRenderer.invoke('account:code', code),
  showCode: () => ipcRenderer.invoke('account:show-code'),
  syncNow: () => ipcRenderer.invoke('account:sync'),
  devices: () => ipcRenderer.invoke('account:devices'),
  signOutDevice: (id) => ipcRenderer.invoke('account:signout-device', id),
  signOut: () => ipcRenderer.invoke('account:signout'),
  deleteAccount: () => ipcRenderer.invoke('account:delete'),
  openAccessibility: () => ipcRenderer.invoke('mac:open-accessibility'),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  hide: () => ipcRenderer.invoke('app:hide'),
  on: (channel, callback) => {
    if (!EVENTS.includes(channel)) return () => {};
    const handler = (_e, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
