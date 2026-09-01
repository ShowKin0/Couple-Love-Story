const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const projectRoot = path.join(__dirname, '..', 'android-app');

test('native Android project keeps the server URL out of tracked source', () => {
  const manifest = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
  const activity = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'java', 'top', 'showkin', 'lovestory', 'MainActivity.java'), 'utf8');
  const api = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'java', 'top', 'showkin', 'lovestory', 'ApiClient.java'), 'utf8');
  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(activity, /class MainActivity/);
  assert.match(activity, /showTimeline|showDiary|showPhotos|showChat/);
  assert.match(api, /BuildConfig\.API_BASE_URL/);
  assert.doesNotMatch(activity, /love\.showkin\.top/);
  assert.doesNotMatch(api, /love\.showkin\.top/);
});

test('native Android UI uses mobile layouts instead of default gray controls', () => {
  const activity = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'java', 'top', 'showkin', 'lovestory', 'MainActivity.java'), 'utf8');
  assert.match(activity, /GridLayout shortcuts/);
  assert.match(activity, /GridLayout grid/);
  assert.match(activity, /private TextView bubble\(/);
  assert.match(activity, /navBg\.setColor\(selected\?/);
  assert.match(activity, /row\.setGravity\(Gravity\.CENTER_VERTICAL\)/);
  assert.match(activity, /LinearLayout row = new LinearLayout\(MainActivity\.this\)/);
});

test('native home and chat follow the website mobile interaction model', () => {
  const activity = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'java', 'top', 'showkin', 'lovestory', 'MainActivity.java'), 'utf8');
  assert.match(activity, /"⚙\\n设置"/);
  assert.doesNotMatch(activity, /Button settings = action\("⚙"/);
  assert.match(activity, /hisAvatar/);
  assert.match(activity, /herAvatar/);
  assert.match(activity, /daysUntilNext/);
  assert.doesNotMatch(activity, /最近的纪念日/);
  assert.match(activity, /LinearLayout composer/);
  assert.match(activity, /EditorInfo\.IME_ACTION_SEND/);
});

test('native app keeps private access and diary media state', () => {
  const activity = fs.readFileSync(path.join(projectRoot, 'app', 'src', 'main', 'java', 'top', 'showkin', 'lovestory', 'MainActivity.java'), 'utf8');
  assert.match(activity, /api\.token\(person\).*loadDiaryEntries/);
  assert.match(activity, /api\.token\(space\).*selectTab\("聊天"\)/);
  assert.match(activity, /PICK_DIARY_IMAGE/);
  assert.match(activity, /PICK_DIARY_AUDIO/);
  assert.match(activity, /MediaRecorder/);
  assert.match(activity, /showPhotoPreview/);
  assert.match(activity, /ScaleGestureDetector/);
  assert.match(activity, /settingsLoaded/);
  assert.match(activity, /正在加载 LoveStory/);
  assert.match(activity, /bottomInset\(\)/);
  assert.match(activity, /settingsScroll=new ScrollView/);
  assert.match(activity, /editorScroll=new ScrollView/);
  assert.match(activity, /setMaxWidth\(\(int\)\(getResources\(\)\.getDisplayMetrics\(\)\.widthPixels\*\.78f\)\)/);
});
