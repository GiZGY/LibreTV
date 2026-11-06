import {defineConfig,devices} from '@playwright/test';
const projects=process.env.OPENSTREAM_DESKTOP_BROWSERS==='1'
 ?['chrome','msedge'].map(channel=>({name:channel,use:{...devices['Desktop Chrome'],channel}}))
 :[{name:'chromium',use:{...devices['Desktop Chrome']}},{name:'webkit',use:{...devices['Desktop Safari']}}];
export default defineConfig({testDir:'tests/browser',timeout:90000,workers:1,retries:0,reporter:'line',use:{baseURL:'http://127.0.0.1:18448',trace:'retain-on-failure',video:'off'},webServer:{command:'node scripts/serve-player-acceptance.mjs',url:'http://127.0.0.1:18448',reuseExistingServer:false,timeout:30000},projects});
