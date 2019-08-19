'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var localStorage = _interopDefault(require('localStorage'));
var jwtDecode = _interopDefault(require('jwt-decode'));
var axios = _interopDefault(require('axios'));

function makeStorageKey(key, ns) {
  return ns ? `${ns}_${key}` : key;
}

class Token {
  constructor(refreshUrl, refreshTTL, storageNamespace) {
    this.refreshUrl = refreshUrl;
    this.decodedToken = null;
    this.tokenExp = 0;
    this.tokenIat = 0;
    this.refreshTTL = refreshTTL;
    this.storageNamespace = storageNamespace;
    this.init();
  }

  init() {
    if (this.getToken()) {
      this.setToken(this.getToken());
    }
  }

  getToken() {
    return localStorage.getItem(makeStorageKey('Authorization', this.storageNamespace));
  }

  setToken(token) {
    if (typeof token !== 'string') {
      this.removeToken();
      console.error('Wrong token');
      return;
    }
    const normalizedToken = token.replace('Bearer ', '');
    localStorage.setItem(makeStorageKey('Authorization', this.storageNamespace), normalizedToken);
    this.decodedToken = jwtDecode(normalizedToken);
    this.tokenExp = this.decodedToken.exp;
    this.tokenIat = this.decodedToken.iat;
  }

  removeToken() {
    localStorage.removeItem(makeStorageKey('Authorization', this.storageNamespace));
    this.decodedToken = null;
    this.tokenExp = null;
    this.tokenIat = null;
  }

  getDecodedToken() {
    return this.decodedToken;
  }

  isExpired() {
    const currentTimestamp = Date.now() / 1000;
    return this.tokenExp < currentTimestamp;
  }

  canRefresh() {
    const currentTimestamp = Date.now() / 1000;
    return this.getToken() && this.tokenIat + this.refreshTTL > currentTimestamp;
  }

  shouldRefresh() {
    return this.isExpired() && this.canRefresh();
  }

  refreshToken(axiosInstance) {
    return new Promise((resolve, reject) => {
      axiosInstance.post(this.refreshUrl, { token: this.getToken() })
        .then(response => {
          const token = response.data.data.access_token;
          this.setToken(token);
          resolve(token);
        })
        .catch(error => {
          this.removeToken();
          reject(error);
        });
    })
  }
}

class Api {
  constructor(config, token) {
    this.token = token;
    this.config = config;
    this.axiosInstance = axios.create(this.config);
    this._addAxiosTokenInterceptor();
    this.refreshingToken = Promise.resolve();
    this.tokenIsRefreshing = false;
  }

  _checkToken() {
    if (this.token.shouldRefresh() && !this.tokenIsRefreshing) {
      this.tokenIsRefreshing = true;

      this.refreshingToken = this.token.refreshToken(this.axiosInstance);

      this.refreshingToken
        .then(() => { this.tokenIsRefreshing = false; })
        .catch(this._tryToLogout);
    }

    if (!this.token.canRefresh()) {
      this.token.removeToken();
    }
  }

  dispatch(method, url, config, data = null) {
    this._checkToken();

    return new Promise((resolve, reject) => {
      this.refreshingToken
        .then(token => {
          const newConfig = config;
          if (token) {
            if (newConfig.headers) {
              newConfig.headers.Authorization = token;
            } else {
              newConfig.headers = {
                Authorization: token
              };
            }
          }
          this._requestResolve(method, url, newConfig, data)
            .then(response => {
              resolve(response);
            })
            .catch(error => {
              reject(error);
            });
        });
    })
  }

  _requestResolve(method, url, config, data) {
    const dataMethods = ['post', 'put', 'patch'];
    const noDataMethods = ['get', 'delete', 'options', 'head'];

    if (dataMethods.includes(method)) {
      return this.axiosInstance[method](url, data, config)
    } else if (noDataMethods.includes(method)) {
      return this.axiosInstance[method](url, config);
    } else {
      throw new Error('Invalid method');
    }
  }
  
  _addAxiosTokenInterceptor() {
    this.axiosInstance.interceptors.request
      .use(config => {
        const newConfig = config;
        const token = this.token.getToken();
        if (token && !this.token.isExpired()) {
          newConfig.headers.Authorization = `Bearer ${token}`;
        }
        return newConfig;
      });
  }
}

class JWTAuthApi {
  constructor(config, refreshUrl, refreshTTL, options) {
    const { storageNamespace } = { ...options };
    
    this.token = new Token(refreshUrl, refreshTTL, storageNamespace);
    this.api = new Api(config, this.token);
  }

  token() {
    return this.token;
  }

  axios() {
    return this.api.axiosInstance;
  }

  get(url, config = {}) {
    return this.api.dispatch('get', url, config);
  }

  delete(url, config = {}) {
    return this.api.dispatch('delete', url, config);
  }

  options(url, config = {}) {
    return this.api.dispatch('options', url, config);
  }

  head(url, config = {}) {
    return this.api.dispatch('head', url, config);
  }

  post(url, data = {}, config = {}) {
    return this.api.dispatch('post', url, config, data);
  }

  put(url, data = {}, config = {}) {
    return this.api.dispatch('put', url, config, data);
  }

  patch(url, data = {}, config = {}) {
    return this.api.dispatch('patch', url, config, data);
  }
}

module.exports = JWTAuthApi;
