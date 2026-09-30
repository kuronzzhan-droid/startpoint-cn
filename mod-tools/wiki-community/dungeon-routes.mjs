import {fail} from './model.mjs';
import {readJSON, readBytes, rateLimit} from './security.mjs';
import {DUNGEON_ID, IMAGE_ID, GUIDE_BYTES, IMAGE_BYTES, requireDungeon} from './dungeon-model.mjs';
import {readGuide, writeGuide} from './dungeon-guides.mjs';
import {readImage, uploadImage, deleteImage} from './dungeon-images.mjs';

const response = (value, status = 200) => Response.json(value, {status,
  headers: {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}});
export async function dungeonRoute(path, request, env, catalog, actor, now, development) {
  const prefix = actor ? '/admin' : '';
  const guide = path.match(new RegExp(`^${prefix}/dungeons/(${DUNGEON_ID})$`));
  if (guide) {
    if (request.method === 'GET') return response(await readGuide(env.COMMUNITY_DB, catalog, guide[1], actor));
    if (actor && request.method === 'PATCH') return response(await writeGuide(env.COMMUNITY_DB, catalog, guide[1],
      await readJSON(request, GUIDE_BYTES), actor, now));
    fail(405, 'method_not_allowed', '攻略读取使用 GET，管理员编辑使用 PATCH。');
  }
  if (actor) {
    const image = path.match(new RegExp(`^/admin/dungeons/(${DUNGEON_ID})/images(?:/(${IMAGE_ID}))?$`));
    if (image) {
      requireDungeon(catalog, image[1]);
      if (image[2] && request.method === 'GET') return readImage(env.COMMUNITY_DB, catalog, image[2], actor, image[1]);
      if (image[2] && request.method === 'DELETE') return response(await deleteImage(env.COMMUNITY_DB, catalog, image[1], image[2], actor, now));
      if (!image[2] && request.method === 'POST') {
        await rateLimit(env.COMMUNITY_DB, request, env, 'dungeon_upload', now, development);
        const bytes = await readBytes(request, IMAGE_BYTES, '每张攻略图片不能超过 512 KiB。');
        return response(await uploadImage(env.COMMUNITY_DB, catalog, image[1], bytes,
          request.headers.get('content-type'), actor, now), 201);
      }
      fail(405, 'method_not_allowed', '图片上传使用 POST，移除使用 DELETE。');
    }
  } else {
    const image = path.match(new RegExp(`^/dungeon-images/(${IMAGE_ID})$`));
    if (image && request.method === 'GET') return readImage(env.COMMUNITY_DB, catalog, image[1]);
  }
  fail(404, 'not_found', '没有这个副本接口。');
}
