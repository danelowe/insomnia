import * as Hawk from 'hawk';
import jwtAuthentication from 'jwt-authentication';

import {
  AUTH_API_KEY,
  AUTH_ASAP,
  AUTH_BASIC,
  AUTH_BEARER,
  AUTH_HAWK,
  AUTH_OAUTH_1,
  AUTH_OAUTH_2,
} from '../common/constants';
import type { RenderedRequest } from '../common/render';
import { RequestParameter } from '../models/request';
import { COOKIE, HEADER, QUERY_PARAMS } from './api-key/constants';
import { getBasicAuthHeader } from './basic-auth/get-header';
import { getBearerAuthHeader } from './bearer-auth/get-header';
import getOAuth1Token from './o-auth-1/get-token';
import getOAuth2Token from './o-auth-2/get-token';

interface Header {
  name: string;
  value: string;
}

export async function getAuthHeader(renderedRequest: RenderedRequest, url: string) {
  const { method, authentication, body } = renderedRequest;
  const requestId = renderedRequest._id;

  if (authentication.disabled) {
    return;
  }

  if (authentication.type === AUTH_API_KEY && authentication.addTo === HEADER) {
    const { key, value } = authentication;
    return {
      name: key,
      value: value,
    } as Header;
  }

  if (authentication.type === AUTH_API_KEY && authentication.addTo === COOKIE) {
    const { key, value } = authentication;
    return {
      name: 'Cookie',
      value: `${key}=${value}`,
    } as Header;
  }

  if (authentication.type === AUTH_BASIC) {
    const { username, password, useISO88591 } = authentication;
    const encoding = useISO88591 ? 'latin1' : 'utf8';
    return getBasicAuthHeader(username, password, encoding);
  }

  if (authentication.type === AUTH_BEARER) {
    const { token, prefix } = authentication;
    return getBearerAuthHeader(token, prefix);
  }

  if (authentication.type === AUTH_OAUTH_2) {
    const oAuth2Token = await getOAuth2Token(requestId, authentication);

    if (oAuth2Token) {
      const token = oAuth2Token.accessToken;
      return _buildBearerHeader(token, authentication.tokenPrefix);
    } else {
      return;
    }
  }

  if (authentication.type === AUTH_OAUTH_1) {
    const oAuth1Token = await getOAuth1Token(url, method, authentication, body);

    if (oAuth1Token) {
      return {
        name: 'Authorization',
        value: oAuth1Token.Authorization,
      };
    } else {
      return;
    }
  }

  if (authentication.type === AUTH_HAWK) {
    const { id, key, algorithm, ext, validatePayload } = authentication;
    let headerOptions = {
      credentials: {
        id,
        key,
        algorithm,
      },
      ext: ext,
    };

    if (validatePayload) {
      const payloadValidationFields = {
        payload: renderedRequest.body.text,
        contentType: renderedRequest.body.mimeType,
      };
      headerOptions = Object.assign({}, payloadValidationFields, headerOptions);
    }

    const { header } = Hawk.client.header(url, method, headerOptions);
    return {
      name: 'Authorization',
      value: header,
    };
  }

  if (authentication.type === AUTH_ASAP) {
    const { issuer, subject, audience, keyId, additionalClaims, privateKey } = authentication;
    const generator = jwtAuthentication.client.create();
    let claims = {
      iss: issuer,
      sub: subject,
      aud: audience,
    };
    let parsedAdditionalClaims;

    try {
      parsedAdditionalClaims = JSON.parse(additionalClaims || '{}');
    } catch (err) {
      throw new Error(`Unable to parse additional-claims: ${err}`);
    }

    if (parsedAdditionalClaims) {
      if (typeof parsedAdditionalClaims !== 'object') {
        throw new Error(
          `additional-claims must be an object received: '${typeof parsedAdditionalClaims}' instead`,
        );
      }

      claims = Object.assign(parsedAdditionalClaims, claims);
    }

    const options = {
      privateKey,
      kid: keyId,
    };
    return new Promise<Header>((resolve, reject) => {
      generator.generateAuthorizationHeader(claims, options, (error, headerValue) => {
        if (error) {
          reject(error);
        } else {
          resolve({
            name: 'Authorization',
            value: headerValue,
          });
        }
      });
    });
  }

  return;
}

export async function getAuthQueryParams(renderedRequest: RenderedRequest) {
  const { authentication } = renderedRequest;

  if (authentication.disabled) {
    return;
  }

  if (authentication.type === AUTH_API_KEY && authentication.addTo === QUERY_PARAMS) {
    const { key, value } = authentication;
    return {
      name: key,
      value: value,
    } as RequestParameter;
  }

  return;
}

export const _buildBearerHeader = (accessToken: string, prefix: string) => {
  if (!accessToken) {
    return;
  }

  const header = {
    name: 'Authorization',
    value: '',
  };

  if (prefix === 'NO_PREFIX') {
    header.value = accessToken;
  } else {
    header.value = `${prefix || 'Bearer'} ${accessToken}`;
  }

  return header;
};
