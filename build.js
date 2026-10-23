'use strict';
const fs = require('fs');
const engine = fs.readFileSync(__dirname + '/engine.js', 'utf8');
if (engine.includes('</script')) throw new Error('engine に </script が含まれています');
const tpl = fs.readFileSync(__dirname + '/app.html', 'utf8');
if (!tpl.includes('/*ENGINE*/')) throw new Error('placeholder がありません');
fs.mkdirSync(__dirname + '/dist', { recursive: true });
const out = tpl.replace('/*ENGINE*/', () => engine);
fs.writeFileSync(__dirname + '/dist/solo.html', out);
// 構文チェック用に script を取り出す
const scripts = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
scripts.forEach((s, i) => fs.writeFileSync(`${__dirname}/dist/script${i}.js`, s));
console.log('built dist/solo.html', (out.length / 1024).toFixed(1) + 'KB', 'scripts:', scripts.length);
