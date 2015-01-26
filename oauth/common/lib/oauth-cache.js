'use strict';

/*
cache: token (as JSON) -> time added (in ms)
*/

var _ = require('underscore');
var debug = require('debug')('oauth');
var Url = require('url');

var create = function(cache, target) {
  return new OAuthCache(cache, target);
};
module.exports.create = create;

var OAuthCache = function(cache, target) {
  if (cache.options.encoding) {
    throw new Error('Cache must not specify an encoding option.');
  }
  this.cache = cache;
  this.target = target;
};

OAuthCache.prototype.cacheToken = function(err, token, cb) {
  try {
    if (err) { return cb(err); }
    var result = token;
    if (typeof token === 'string') {
      token = Url.parse(token);
    }
    if (!token.access_token) { return cb(err, result); }
    var key = token.access_token;
    token.cached_at = new Date().getTime();
    var target = JSON.stringify(token);
    if (debug.enabled) { debug('cache token: ' + target); }
    var opts = null;
    if (token.expires_in) {
      var ttl = token.expires_in * 1000;  // expires_in is seconds, ttl is ms
      opts = { ttl: Math.min(ttl, this.cache.options.ttl) };  // max upper limit at this.cache.options.ttl
    }
    this.cache.set(key, target, opts);
    cb(null, result);
  } catch (err) {
    debug('err: ' + err);
    cb(err);
  }
};

OAuthCache.prototype.getCachedToken = function(token, cb) {
  var key = (_.isString(token)) ? token : token.access_token;
  this.cache.get(key, function(err, reply) {
    if (err) { return cb(err); }
    if (!reply) {
      if (debug.enabled) { debug('cache miss: ' + key); }
      return cb(err, reply);
    }

    var token;
    try {
      token = JSON.parse(reply.toString());
    }
    catch (err) {
      if (debug.enabled) { debug('err:  ' + err); }
      cb(err, null);
    }

    // update expires_in
    var elapsed = new Date().getTime() - token.cached_at;
    token.expires_in = token.expires_in - (elapsed / 1000);
    delete(token.cached_at);

    if (debug.enabled) { debug('cache hit:  ' + key); }
    cb(err, token);
  });
};

OAuthCache.prototype.deleteCachedToken = function(token) {
  var key = (_.isString(token)) ? token : token.access_token;
  this.cache.delete(key);
};

/*
 * Generate an access token using client_credentials. Parameters:
 *   clientId: required
 *   clientSecret: required
 *   scope: optional
 *   tokenLifetime: lifetime in milliseconds, optional
 *   attributes: hash of custom attributes to store and retrieve with token
 *
 * Returns an object with all the fields in the standard OAuth 2.0 response.
 */
OAuthCache.prototype.createTokenClientCredentials = function(options, cb) {
  var self = this;
  this.target.createTokenClientCredentials(options, function(err, reply) {
    self.cacheToken(err, reply, cb);
  });
};

/*
 * Generate an access token using password credentials. Parameters:
 *   clientId: required
 *   clientSecret: required
 *   scope: optional
 *   tokenLifetime: lifetime in milliseconds, optional
 *   username: required but not checked (must be checked outside this module)
 *   password: required by not checked (must be checked outside this module)
 *   attributes: hash of custom attributes to store and retrieve with token
 *
 * Returns an object with all the fields in the standard OAuth 2.0 response.
 */
OAuthCache.prototype.createTokenPasswordCredentials = function(options, cb) {
  var self = this;
  this.target.createTokenPasswordCredentials(options, function(err, reply) {
    self.cacheToken(err, reply, cb);
  });
};

/*
 * Generate an access token for authorization code once a code has been set up. Parameters:
 *   clientId: required
 *   clientSecret: required
 *   code: Authorization code already generated by the "generateAuthorizationCode" method
 *   redirectUri: The same redirect URI that was set in the call to generate the authorization code
 *   tokenLifetime: lifetime in milliseconds, optional
 *   attributes: hash of custom attributes to store and retrieve with token
 *
 * Returns an object with all the fields in the standard OAuth 2.0 response.
 */
OAuthCache.prototype.createTokenAuthorizationCode = function(options, cb) {
  var self = this;
  this.target.createTokenAuthorizationCode(options, function(err, reply) {
    self.cacheToken(err, reply, cb);
  });
};

/*
 * Generate a redirect response for the authorization_code grant type. Parameters:
 *   clientId: required
 *   redirectUri: optional - if present, must match what was deployed along with the app
 *   scope: optional
 *   state: optional but certainly recommended
 *
 * Returns the redirect URI as a string.
 * 4.1.2
 */
OAuthCache.prototype.generateAuthorizationCode = function(options, cb) {
  this.target.generateAuthorizationCode(options, cb);
};

/*
 * Generate a redirect response for the implicit grant type. Parameters:
 *   clientId: required
 *   redirectUri: optional - if present, must match what was deployed along with the app
 *   scope: optional
 *   state: optional but certainly recommended
 *   attributes: hash of custom attributes to store and retrieve with token
 *
 * Returns the redirect URI as a string.
 */
OAuthCache.prototype.createTokenImplicitGrant = function(options, cb) {
  var self = this;
  this.target.createTokenImplicitGrant(options, function(err, reply) {
    self.cacheToken(err, reply, cb);
  });
};

/*
 * Refresh an existing access token, and return a new token. Parameters:
 *   clientId: required
 *   clientSecret: required
 *   refreshToken: required, from the original token grant
 */
OAuthCache.prototype.refreshToken = function(options, cb) {
  var self = this;
  this.target.refreshToken(options, function(err, reply) {
    self.cacheToken(err, reply, cb);
  });
};

/*
 * Invalidate an existing token. Options is a hash containing:
 *   clientId: required
 *   clientSecret: required
 *   token: required
 *   tokenTypeHint: optional
 */
OAuthCache.prototype.invalidateToken = function(options, cb) {
  this.deleteCachedToken(options.token);
  this.target.invalidateToken(options, cb);
};

/*
 * Validate an access token.
 */
OAuthCache.prototype.verifyToken = function(token, requiredScopes, cb) {
  var self = this;
  this.getCachedToken(token, function(err, reply) {
    if (reply) {
      if (requiredScopes) { // check scopes
        if (!Array.isArray(requiredScopes)) {
          requiredScopes = requiredScopes ? requiredScopes.split(' ') : [];
        }
        var grantedScopes = reply.scope ? reply.scope.split(' ') : [];
        if (_.difference(requiredScopes, grantedScopes).length > 0) {
          return cb(errorWithCode('invalid_scope'));
        }
      }
      cb(null, reply);
    } else {
      self.target.verifyToken(token, requiredScopes, function(err, reply) {
        if (err) { return cb(err); }
        reply.access_token = token;
        self.cacheToken(err, reply, cb);
      });
    }
  });
};

OAuthCache.prototype.cacheApiKey = function(apiKey, cb) {
  try {
    var key = 'apiKey:' + apiKey;
    this.cache.set(key, apiKey);
    cb(null, apiKey);
  } catch (err) {
    debug('err: %s', err);
    cb(err);
  }
};

OAuthCache.prototype.getCachedApiKey = function(apiKey, cb) {
  var key = 'apiKey:' + apiKey;
  this.cache.get(key, function(err, reply) {
    if (err) { return cb(err); }
    if (!reply) {
      debug('cache miss: %s', key);
      return cb();
    }

    debug('cache hit: %s', key);
    cb(err, apiKey);
  });
};

/*
 * Validate an API Key.
 */
OAuthCache.prototype.verifyApiKey = function(apiKey, request, cb) {
  var self = this;
  this.getCachedApiKey(apiKey, function(err, reply) {
    if (err || reply) { return cb(err, !!reply); }

    self.target.verifyApiKey(apiKey, request, function(err) {
      if (err) { return cb(err); }

      self.cacheApiKey(apiKey, function(err, reply) {
        if (err) { return cb(err);}
        cb(null, !!reply);
      });
    });
  });
};

function errorWithCode(code) {
  var err = new Error(code);
  err.errorCode = code;
  return err;
}
