/**
 * Release build: writes docs/index.html, the whole app in ONE file for GitHub Pages (Settings > Pages > main, /docs).
 * The sources stay as they are (plain split files, index.html opens straight from disk); this only reads them.
 *
 *   npm install      (once: esbuild + three, devDependencies)
 *   npm run build
 *
 * What it does:
 * - the local <script defer> files of index.html, in the same order, joined into one script and minified (top-level
 *   names are kept: they are the globals the files share, and index.html calls a few of them from onclick/onload);
 * - three.js is bundled in (only the classes the code uses, found by scanning for THREE.X), so the importmap and the
 *   CDN module script go away; OpenCV.js stays on its CDN (10 MB, loaded only when a screenshot is scanned);
 * - debug-only data is left out: the built-in photos (js/PhotoData.js, 2 MB, replaced by an empty PHOTO_DATA so an
 *   uploaded screenshot still works) and the synthetic scene generator; their options leave the debug photo menu;
 * - app.css is inlined and minified, HTML comments and indentation are dropped; llms.txt (for AI agents) is copied alongside.
 */
const fs = require('fs'), path = require('path'), zlib = require('zlib')
const esbuild = require('esbuild')

const ROOT = path.join(__dirname, '..'), OUT_DIR = path.join(ROOT, 'docs')
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
/** dev-only scripts: replaced by this text in the release ('' = dropped) */
const DEV_ONLY = {
	'js/PhotoData.js': 'const PHOTO_DATA = {} // release: no built-in photos, only the screenshots the user uploads\n',
	'reference/synthetic/tools/synth_page.js': '',
}

function fail(msg) { console.error('build failed: ' + msg); process.exit(1) }
/** replaces `re` in `text`, failing when it matches a different number of times than expected (the page changed) */
function replaceExpect(text, re, by, expected, what) {
	let n = (text.match(re) || []).length
	if (expected !== undefined && n !== expected) fail(what + ': expected ' + expected + ' match(es), found ' + n)
	return text.replace(re, by)
}

async function main() {
	let html = read('index.html')

	// 1. the app's own scripts, in page order
	const scriptTag = /[ \t]*<script src="([^"]+)" defer><\/script>\r?\n?/g
	const srcs = [...html.matchAll(scriptTag)].map((m) => m[1])
	if (!srcs.length) fail('no <script src=... defer> found in index.html')
	for (let s of Object.keys(DEV_ONLY)) if (!srcs.includes(s)) fail('dev-only script ' + s + ' is not in index.html any more: update DEV_ONLY')
	if (!/^const PHOTO_DATA = \{/m.test(read('js/PhotoData.js'))) fail('js/PhotoData.js no longer declares const PHOTO_DATA: update DEV_ONLY')
	const appCode = srcs.map((s) => s in DEV_ONLY ? DEV_ONLY[s] : read(s)).join('\n;\n')
	const app = await esbuild.transform(appCode, { loader: 'js', minify: true, legalComments: 'eof', charset: 'utf8' }) // eof: any /*! */ licence notice is kept, at the end
	for (let name of ['exportVein', 'onOpenCvReady']) if (!new RegExp('function ' + name + '\\(').test(app.code)) fail(name + ' was renamed by the minifier, but index.html calls it')

	// 2. three.js: only the classes used as THREE.X, checked against what three really exports
	const threeExports = new Set(Object.keys(await import('three')))
	const used = [...new Set([...appCode.matchAll(/\bTHREE\.([A-Za-z_]\w*)/g)].map((m) => m[1]))].filter((n) => threeExports.has(n)).sort()
	if (!appCode.includes('THREE.OrbitControls')) fail('THREE.OrbitControls is no longer used: update the three.js entry')
	const entry = 'import { ' + used.join(', ') + " } from 'three'\nimport { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'\n" +
		'window.THREE = { ' + used.join(', ') + ', OrbitControls }\n'
	const three = await esbuild.build({ stdin: { contents: entry, resolveDir: ROOT }, bundle: true, minify: true, format: 'iife', write: false, legalComments: 'inline', charset: 'utf8' })
	const threeCode = three.outputFiles[0].text

	// 3. the page
	let js = threeCode + ';\n' + app.code
	js = js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--') // must not end the inline <script> early
	const css = (await esbuild.transform(read('app.css'), { loader: 'css', minify: true })).code.trim()
	html = replaceExpect(html, /[ \t]*<script type="importmap">[\s\S]*?<\/script>\r?\n?/g, '', 1, 'importmap')
	html = replaceExpect(html, /[ \t]*<script type="module">[\s\S]*?<\/script>\r?\n?/g, '', 1, 'three.js module script')
	html = replaceExpect(html, scriptTag, '', srcs.length, 'local scripts')
	html = replaceExpect(html, /<link rel="stylesheet" href="app\.css">/g, () => '<style>' + css + '</style>', 1, 'app.css link')
	html = replaceExpect(html, /<option value="geode\d+">[^<]*<\/option>/g, '', undefined, 'built-in photo options')
	html = html.replace(/<!--(?!\[)[\s\S]*?-->/g, '')
	html = replaceExpect(html, /<\/body>/g, () => '<script>' + js + '</script>\n</body>', 1, '</body>')
	html = html.split(/\r?\n/).map((l) => l.trim()).filter((l) => l).join('\n') + '\n'

	fs.mkdirSync(OUT_DIR, { recursive: true })
	fs.writeFileSync(path.join(OUT_DIR, 'index.html'), html)
	fs.writeFileSync(path.join(OUT_DIR, '.nojekyll'), '') // Pages: serve the file as is
	fs.copyFileSync(path.join(ROOT, 'llms.txt'), path.join(OUT_DIR, 'llms.txt')) // instructions for AI agents, at the site root
	const kb = (n) => (n / 1024).toFixed(0) + ' KB'
	const srcBytes = srcs.filter((s) => !(s in DEV_ONLY)).reduce((a, s) => a + Buffer.byteLength(read(s)), 0)
	console.log('docs/index.html: ' + kb(Buffer.byteLength(html)) + ' (gzip ' + kb(zlib.gzipSync(html).length) + ')')
	console.log('  app code: ' + srcs.length + ' files, ' + kb(srcBytes) + ' -> ' + kb(Buffer.byteLength(app.code)) + '; three.js (' + (used.length + 1) + ' classes): ' + kb(Buffer.byteLength(threeCode)) + '; css: ' + kb(css.length))
}
main().catch((e) => fail(e.stack || e.message))
