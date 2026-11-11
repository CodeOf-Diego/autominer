/**
 * The app shell around the pipeline (index.html + app.css): the landing page, the saved geodes, the 7-step HUD, the
 * settings and the debug switch. The pipeline itself stays in js/main/ and js/stage1/; js/app/ only drives it (newRun,
 * processVein, loadCalibrationPhoto, renderStage) and stores what the user did.
 *
 * Saved geodes live in IndexedDB (js/app/store.js), one record per geode:
 *   {id, name, source: 'photo'|'random'|'import', created, updated, step, maxStep,
 *    vein: {seed, size, ores} | null   (the amethyst cells, as veinToSparse(); for a photo, set once the scan has found them)
 *    photo: Blob (the original screenshot, photo only), edits: [...] (manual cube corrections, photo only), thumb: data URL}
 * Every change (step, name, edits, scan result) is written back within half a second, and right away when the page
 * is hidden or closed, so nothing is lost if the tab times out. IndexedDB rather than localStorage because screenshots
 * are several MB and localStorage holds about 5 MB in all.
 *
 * App is one object: this file holds its state, the other js/app/ files add its functions (Object.assign).
 */
const App = {
	STEPS: APP_STEPS,
	entry: null, // the geode open (a saved record, or the transient dev session), null on the landing page
	debug: false,
	loadPrefs,
	inWorkspace: () => !!App.entry && document.body.dataset.screen === 'workspace',
	modalOpen: () => !$('settings_modal').hidden,
}
const HERO_SEED = 20251, HERO_STAGE = 6 // the geode turning behind the landing page
const LAST_KEY = 'autominer.last', DEBUG_KEY = 'autominer.debug', CARD_KEY = 'autominer.cardCollapsed'

const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
/** The PHOTO_DATA key of a geode's screenshot */
const photoKey = (e) => 'entry:' + e.id
const sparseOfPipeline = () => Object.assign({ seed: pipeline.seed }, veinToSparse(pipeline.vein.matrix))
const hasPhoto = () => App.entry && (App.entry.source === 'photo' || App.entry.source === 'dev')
const pipelineReady = () => pipeline !== null && (App.entry.source !== 'photo' || !!App.entry.vein)
