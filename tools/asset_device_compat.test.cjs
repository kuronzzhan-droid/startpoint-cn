const assert = require("node:assert/strict");

const {
    DIFF_ARCHIVE_SUBDIRS,
    ENTITY_LISTS_DIR,
    FULL_ARCHIVE_SUBDIRS,
    getEntityListName,
    getDiffArchiveSubdirs,
    getFullArchiveSubdirs,
    getVersionInfo,
    isIosAssetDevice,
    isSupportedAssetDevice,
} = require("../out/routes/cn/asset.js");

for (const device of [undefined, "1", "2", "ios", "IOS", "android", "ANDROID"]) {
    assert.equal(isSupportedAssetDevice(device), true, `expected ${device} to be accepted`);
}

for (const device of ["0", "3", "windows", "unknown", ""]) {
    assert.equal(isSupportedAssetDevice(device), false, `expected ${device} to be rejected`);
}

assert.equal(isIosAssetDevice("1"), true);
assert.equal(isIosAssetDevice("IOS"), true);
assert.equal(isIosAssetDevice("2"), false);
assert.equal(getEntityListName("1"), "10939-ios_medium.csv");
assert.equal(getEntityListName("android"), "10939-android_medium.csv");
const iosInfo = getVersionInfo("https://cdn.example/patch/cn", 123, "ios");
assert.equal(iosInfo.files_list, `https://cdn.example/patch/cn/${ENTITY_LISTS_DIR}/10939-ios_medium.csv`);
assert.equal(
    iosInfo.base_url,
    ENTITY_LISTS_DIR === "entities"
        ? "https://cdn.example/patch/cn/entities/files/"
        : "https://cdn.example/patch/cn/EntityLists/",
);
assert.equal(iosInfo.total_size, 123);
assert.equal(iosInfo.delayed_assets_size, 0);

assert.deepEqual(getFullArchiveSubdirs("ios"), [
    "archive-common-full",
    "archive-medium-full",
    "archive-ios-full",
]);
assert.deepEqual(getFullArchiveSubdirs("android"), [
    "archive-common-full",
    "archive-medium-full",
    "archive-android-full",
]);
assert.deepEqual(getDiffArchiveSubdirs("1"), [
    "archive-common-diff",
    "archive-medium-diff",
    "archive-ios-diff",
]);
assert.deepEqual(getDiffArchiveSubdirs(undefined), [
    "archive-common-diff",
    "archive-medium-diff",
    "archive-android-diff",
]);

assert.deepEqual(FULL_ARCHIVE_SUBDIRS, [
    "archive-common-full",
    "archive-medium-full",
    "archive-android-full",
    "archive-ios-full",
]);

assert.deepEqual(DIFF_ARCHIVE_SUBDIRS, [
    "archive-common-diff",
    "archive-medium-diff",
    "archive-android-diff",
    "archive-ios-diff",
]);

console.log("asset device compatibility tests passed");
