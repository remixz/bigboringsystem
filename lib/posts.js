'use strict';

var level = require('level');
var Boom = require('boom');
var concat = require('concat-stream');
var moment = require('moment');
var nconf = require('nconf');

var services = require('./services');
var utils = require('./utils');

nconf.argv().env().file({ file: 'local.json' });

var MAX_POSTS = 10;

var db = level('./db/posts', {
  createIfMissing: true,
  valueEncoding: 'json'
});

var getTime = function () {
  return Math.floor(Date.now() / 1000);
};

exports.db = function () {
  return db;
};

exports.add = function (request, reply) {
  var time = getTime();

  var postItem = {
    uid: request.session.get('uid'),
    name: request.session.get('name'),
    created: time,
    reply: utils.autoLink(request.payload.reply) || '',
    content: utils.autoLink(request.payload.content, {
      htmlEscapeNonEntities: true,
      targetBlank: true
    })
  };

  db.put('user!' + request.session.get('uid') + '!' + time, postItem, function (err, post) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    db.put('post!' + time, postItem, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 400));
      }

      reply.redirect('/posts');
    });
  });
};

var setDate = function (created) {
  return moment(created * 1000).format('MMM Do, YYYY');
};

var setPagination = function (defaultKey, request, next) {
  var key;
  var cs = db.createKeyStream({
    gte: defaultKey,
    limit: 1
  });

  cs.on('error', function (err) {
    return next(err);
  });

  cs.on('data', function (data) {
    key = data;
  });

  cs.on('end', function () {
    var uid = request.session.get('uid');
    var streamOpt = {
      gte: defaultKey,
      limit: MAX_POSTS,
      reverse: true
    };

    if (request.query.last) {
      streamOpt.lt = request.query.last;
    } else {
      streamOpt.lte = defaultKey + '\xff';
    }

    return next(null, {
      stream: streamOpt,
      finalKey: key
    });
  });
};

exports.getAllRecent = function (request, reply) {
  setPagination('post!', request, function (err, streamOpt) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    var rs = db.createReadStream(streamOpt.stream);

    rs.pipe(concat(function (posts) {
      var firstKey = false;
      var lastKey = false;

      if (posts.length) {
        firstKey = posts[0].key;
        lastKey = posts[posts.length - 1].key;
      }

      return reply.view('discover', {
        firstKey: firstKey,
        lastKey: lastKey,
        next: (streamOpt.finalKey !== lastKey),
        analytics: nconf.get('analytics'),
        session: request.session.get('uid'),
        posts: posts.map(function (post) {
          post.value.created = setDate(post.value.created);
          return post;
        })
      });
    }));

    rs.on('error', function (err) {
      return reply(Boom.wrap(err, 400));
    });
  });
};

exports.getRecent = function (request, reply) {
  var uid = request.session.get('uid');

  setPagination('user!' + uid + '!', request, function (err, streamOpt) {
    if (err) {
      return reply(Boom.wrap(err, 400));
    }

    var rs = db.createReadStream(streamOpt.stream);

    rs.pipe(concat(function (posts) {
      var firstKey = false;
      var lastKey = false;

      if (posts.length) {
        firstKey = posts[0].key;
        lastKey = posts[posts.length - 1].key;
      }

      posts = posts.map(function (post) {
        post.value.created = setDate(post.value.created);
        return post;
      });

      return reply.view('posts', {
        firstKey: firstKey,
        lastKey: lastKey,
        next: (streamOpt.finalKey !== lastKey),
        analytics: nconf.get('analytics'),
        session: uid,
        posts: posts
      });
    }));

    rs.on('error', function (err) {
      return reply(Boom.wrap(err, 400));
    });
  });
};

exports.getRecentForUser = function (uid, request, next) {
  setPagination('user!' + uid + '!', request, function (err, streamOpt) {
    if (err) {
      return next(err);
    }

    var rs = db.createReadStream(streamOpt.stream);

    rs.pipe(concat(function (posts) {
      var firstKey = false;
      var lastKey = false;

      if (posts.length) {
        firstKey = posts[0].key;
        lastKey = posts[posts.length - 1].key;
      }

      posts = posts.map(function (post) {
        post.value.created = setDate(post.value.created);
        return post;
      });

      next(null, {
        firstKey: firstKey,
        lastKey: lastKey,
        paginate: (streamOpt.finalKey !== lastKey),
        posts: posts
      });
    }));

    rs.on('error', function (err) {
      next(err);
    });
  });
};

exports.del = function (request, reply) {
  if (request.session && request.session.get('uid') === request.payload.uid) {
    var keyArr = request.params.key.split('!');
    var time = keyArr[keyArr.length - 1];

    db.del('post!' + time, function (err) {
      if (err) {
        return reply(Boom.wrap(err, 404));
      }

      db.del('user!' + request.session.get('uid') + '!' + time);
      reply.redirect('/posts');
    });
  } else {
    reply.redirect('/');
  }
}

exports.get = function (request, reply) {
  db.get(request.params.key, function (err, post) {
    if (err) {
      return reply(Boom.wrap(err, 404));
    }

    post.created = setDate(post.created);

    reply.view('post', {
      analytics: nconf.get('analytics'),
      id: request.params.key,
      session: request.session.get('uid') || false,
      post: post
    });
  });
};
