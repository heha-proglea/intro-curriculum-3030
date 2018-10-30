'use strict';

// 暗号化のための関数(ハッシュ関数等)を持った、cryptoモジュールの読み込み
const crypto = require('crypto');

const pug = require('pug');
const Cookies = require('cookies');
const moment = require('moment-timezone');
const util = require('./handler-util');
const Post = require('./post');

const trackingIdKey = 'tracking_id';

function handle(req, res) {
  const cookies = new Cookies(req, res);

  // addTrackingCookie(cookies);
  // ユーザー名を用いた検証済みのものを、トラッキングIDとして使う。
  const trackingId = addTrackingCookie(cookies, req.user);

  switch (req.method) {
    case 'GET':
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8'
      });
      Post.findAll({ order: [['id', 'DESC']] }).then((posts) => {
        posts.forEach((post) => {
          post.content = post.content.replace(/\+/g, ' ');
          post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
        });
        res.end(pug.renderFile('./views/posts.pug', {
          posts: posts,
          user: req.user
        }));
        console.info(
          `閲覧されました: user: ${req.user}, ` +
          // `trackinId: ${cookies.get(trackingIdKey)},` +
          `trackingId: ${trackingId},` + // ログに表示するのは、検証済みのトラッキングID
          `remoteAddress: ${req.connection.remoteAddress}, ` +
          `userAgent: ${req.headers['user-agent']} `
        );
      });
      break;
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        const content = decoded.split('content=')[1];
        console.info('投稿されました: ' + content);
        Post.create({
          content: content,
          // trackingCookie: cookies.get(trackingIdKey),
          trackingCookie: trackingId, // データベースに保存するのは、検証済みのトラッキングID
          postedBy: req.user
        }).then(() => {
          handleRedirectPosts(req, res);
        });
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

function handleDelete(req, res) {
  switch (req.method) {
    case 'POST':
      let body = [];
      req.on('data', (chunk) => {
        body.push(chunk);
      }).on('end', () => {
        body = Buffer.concat(body).toString();
        const decoded = decodeURIComponent(body);
        const id = decoded.split('id=')[1];
        Post.findById(id).then((post) => {
          if (req.user === post.postedBy || req.user === 'admin') {
            post.destroy();
            console.info(
              `削除されました: user: ${req.user}, ` +
              `remoteAddress: ${req.connection.remoteAddress}, ` +
              `userAgent: ${req.headers['user-agent']} `
            );
          }
          handleRedirectPosts(req, res);
        });
      });
      break;
    default:
      util.handleBadRequest(req, res);
      break;
  }
}

// function addTrackingCookie(cookies) {
//   if (!cookies.get(trackingIdKey)) {
//     const trackingId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
//     const tomorrow = new Date(new Date().getTime() + (1000 * 60 * 60 * 24));
//     cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
//   }
// }

// トラッキングID(仮)に対して、ユーザー名を用いた検証を行う
/**
 * Cookieに含まれているトラッキングIDに異常がなければその値を返し、
 * 存在しない場合や異常なものである場合には、再度作成しCookieに付与してその値を返す
 * @param {Cookies} cookies
 * @param {String} userName
 * @return {String} トラッキングID
 */
function addTrackingCookie(cookies, userName) {
  // Cookieから送られてきたものをトラッキングID(仮)とする
  const requestedTrackingId = cookies.get(trackingIdKey);
  // 送られてきたトラッキングID(仮)が正しいかどうか、ユーザー名を用いて検証を行う
  if (isValidTrackingId(requestedTrackingId, userName)) {
    // 検証した結果、トラッキングID(仮)が正当なものであれば、それをトラッキングIDとして使用する
    return requestedTrackingId;
  } else {
    // 検証した結果、トラッキングID(仮)が正当なもので無いのなら、新たにトラッキングIDを作成してそれを使用する
    const originalId = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
    const tomorrow = new Date(new Date().getTime() + (1000 * 60 * 60 * 24));
    const trackingId = originalId + '_' + createValidHash(originalId, userName);
    cookies.set(trackingIdKey, trackingId, { expires: tomorrow });
    return trackingId;
  }
}

// トラッキングID(仮)が正当なものかどうか、ユーザー名を用いて検証をする関数
function isValidTrackingId(trackingId, userName) { // trackingIdにはCookieから送られてきたトラッキングID(仮)が入る。
  if (!trackingId) {
    // ユーザー名を持たない場合(＝直前の24h以内についてこの掲示板へ来ていない場合?)は、正当でないとして扱う
    return false;
  }
  const splitted = trackingId.split('_');
  // 送られてきたトラッキングID(仮)の形式は、「(元々のID)_(元々のIDとユーザー名を利用したもののハッシュ値)」である
  const originalId = splitted[0];
  const requestedHash = splitted[1];
  // 作成したハッシュ値と送られてきたハッシュ値が一致するならば、それは正当なトラッキングIDである
  return createValidHash(originalId, userName) === requestedHash;
}

// ハッシュ値作る関数
function createValidHash(originalId, userName) {
  // SHA-1アルゴリズムを用いて、ハッシュ値を作成する
  const sha1sum = crypto.createHash('sha1');
  sha1sum.update(originalId + userName);
  // ハッシュ値を16 進数の文字列として返す
  return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
  res.writeHead(303, {
    'Location': '/posts'
  });
  res.end();
}

module.exports = {
  handle: handle,
  handleDelete: handleDelete
};
