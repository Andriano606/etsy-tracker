// UI harness preload: window.api = the fake API over the fixtures.
const { contextBridge } = require('electron')
const fs = require('fs')
const fakeApi = require('./fake-api.cjs')
const fx = JSON.parse(fs.readFileSync(process.env.UIH_FIXTURES, 'utf8'))
contextBridge.exposeInMainWorld('api', fakeApi(fx, { signedOut: process.env.UIH_SIGNED_OUT === '1' }))
