
var start = require('./common')
  , should = require('should')
  , assert = require('assert')
  , random = require('../lib/utils').random
  , mongoose = start.mongoose
  , Mongoose = mongoose.Mongoose
  , Schema = mongoose.Schema;

var uri = process.env.MONGOOSE_SHARD_TEST_URI;

if (!uri) {
  console.log('\033[31m', '\n', 'You\'re not testing shards!'
            , '\n', 'Please set the MONGOOSE_SHARD_TEST_URI env variable.', '\n'
            , 'e.g: `mongodb://localhost:27017/database', '\n'
            , 'Sharding must already be enabled on your database'
            , '\033[39m');

  // let expresso shut down this test
  exports.r = function expressoHack(){}
  return;
}

var schema = new Schema({
    name: String
  , age: Number
  , likes: [String]
}, { shardkey: { name: 1, age: 1 }});

var collection = 'shardperson_' + random();
mongoose.model('ShardPerson', schema, collection);

var db = start({ uri: uri });
db.on('error', function (err) {
  if (/failed to connect/.test(err)) {
    err.message = 'Shard test error: '
      + err.message
      + '\n'
      + '    Are you sure there is a db running at '
      + uri + ' ?'
      + '\n'
  }
  // let expresso shut down this test
  exports.r = function expressoHack(){}
  throw err;
});
db.on('open', function () {
  // set up a sharded test collection
  var P = db.model('ShardPerson', collection);

  var cmd = {};
  cmd.shardcollection = db.name + '.' + collection;
  cmd.key = P.schema.options.shardkey;

  P.db.db.executeDbAdminCommand(cmd,function (err, res) {
    db.close();

    if (err) throw err;

    if (!(res && res.documents && res.documents[0] && res.documents[0].ok)) {
      throw new Error('could not shard test collection ' + collection);
    }

    // assign exports to tell expresso to begin
    Object.keys(tests).forEach(function (test) {
      exports[test] = tests[test];
    });

  });
});

var tests = {

  'can read and write to a shard': function () {
    var db = start({ uri:  uri })
    var P = db.model('ShardPerson', collection);

    P.create({ name: 'ryu', age: 25, likes: ['street fighting']}, function (err, ryu) {
      should.strictEqual(null, err);
      P.findById(ryu._id, function (err, doc) {
        db.close();
        should.strictEqual(null, err);
        doc.id.should.equal(ryu.id);
      });
    });
  },

  'save() and remove() works with shard keys transparently': function () {
    var db = start({ uri:  uri })
    var P = db.model('ShardPerson', collection);

    var zangief = new P({ name: 'Zangief', age: 33 });
    zangief.save(function (err) {
      should.strictEqual(null, err);

      zangief._shardval.name.should.equal('Zangief');
      zangief._shardval.age.should.equal(33);

      P.findById(zangief._id, function (err, zang) {
        should.strictEqual(null, err);

        zang._shardval.name.should.equal('Zangief');
        zang._shardval.age.should.equal(33);

        zang.likes = ['spinning', 'laughing'];
        zang.save(function (err) {
          should.strictEqual(null, err);

          zang._shardval.name.should.equal('Zangief');
          zang._shardval.age.should.equal(33);

          zang.likes.addToSet('winning');
          zang.save(function (err) {
            should.strictEqual(null, err);
            zang._shardval.name.should.equal('Zangief');
            zang._shardval.age.should.equal(33);
            zang.remove(function (err) {
              db.close();
              should.strictEqual(null, err);
            });
          });
        });
      });
    });
  },

  'inserting to a sharded collection without the full shard key fails': function () {
    var db = start({ uri:  uri })
    var P = db.model('ShardPerson', collection);

    var pending = 6;

    P.create({ name: 'ryu', likes: ['street fighting']}, function (err, ryu) {
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

    P.create({ likes: ['street fighting']}, function (err, ryu) { assert.ok(err);
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

    P.create({ name: 'ryu' }, function (err, ryu) { assert.ok(err);
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

    P.create({ age: 49 }, function (err, ryu) { assert.ok(err);
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

    P.create({ likes: ['street fighting'], age: 8 }, function (err, ryu) {
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

    var p = new P;
    p.save(function (err) {
      --pending || db.close();
      assert.ok(err);
      /tried to insert object with no valid shard key/.test(err.message).should.be.true;
    });

  },

  'updating a sharded collection without the full shard key fails': function () {
    var db = start({ uri:  uri })
    var P = db.model('ShardPerson', collection);

    P.create({ name: 'ken', age: 27 }, function (err, ken) {
      should.strictEqual(null, err);

      P.update({ name: 'ken' }, { likes: ['kicking', 'punching'] }, function (err) {
        /full shard key/.test(err.message).should.be.true;

        P.update({ _id: ken._id, name: 'ken' }, { likes: ['kicking', 'punching'] }, function (err) {
          assert.ok(!err);

          P.update({ _id: ken._id, age: 27 }, { likes: ['kicking', 'punching'] }, function (err) {
            assert.ok(!err);

            P.update({ age: 27 }, { likes: ['kicking', 'punching'] }, function (err) {
              db.close();
              assert.ok(err);
            });
          });
        });
      });
    });
  },

  'updating shard key values fails': function () {
    var db = start({ uri:  uri })
    var P = db.model('ShardPerson', collection);
    P.create({ name: 'chun li', age: 19, likes: ['street fighting']}, function (err, chunli) {
      should.strictEqual(null, err);

      chunli._shardval.name.should.equal('chun li');
      chunli._shardval.age.should.equal(19);

      chunli.age = 20;
      chunli.save(function (err) {
        /^Can't modify shard key's value/.test(err.message).should.be.true;

        chunli._shardval.name.should.equal('chun li');
        chunli._shardval.age.should.equal(19);

        P.findById(chunli._id, function (err, chunli) {
          should.strictEqual(null, err);

          chunli._shardval.name.should.equal('chun li');
          chunli._shardval.age.should.equal(19);

          chunli.name='chuuuun liiiii';
          chunli.save(function (err) {
            db.close();
            /^Can't modify shard key's value/.test(err.message).should.be.true;
          });
        });
      });
    });
  }
}
