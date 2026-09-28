/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import { module, test } from 'qunit';
import { setupTest } from 'ember-qunit';
import { setupMirage } from 'ember-cli-mirage/test-support';
import Sinon from 'sinon';
import { reject } from 'rsvp';

const openapiStub = {
  openapi: {
    components: {
      schemas: {
        UsersRequest: {
          type: 'object',
          properties: {
            password: {
              description: 'Password for the user',
              type: 'string',
              'x-vault-displayAttrs': { sensitive: true },
            },
          },
        },
      },
    },
    paths: {
      '/users/{username}': {
        post: {
          requestBody: {
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/UsersRequest' },
              },
            },
          },
        },
        parameters: [
          {
            description: 'Username for this user.',
            in: 'path',
            name: 'username',
            required: true,
            schema: { type: 'string' },
          },
        ],
        'x-vault-displayAttrs': { itemType: 'User', action: 'Create' },
      },
    },
  },
};

module('Unit | Service | path-help', function (hooks) {
  setupTest(hooks);
  setupMirage(hooks);

  hooks.beforeEach(function () {
    this.pathHelp = this.owner.lookup('service:path-help');
    this.store = this.owner.lookup('service:store');
  });

  module('getNewModel', function (hooks) {
    hooks.beforeEach(function () {
      this.server.get('/auth/userpass/', () => openapiStub);
      this.server.get('/auth/userpass/users/example', () => openapiStub);
    });
    test('it generates a model with mutableId', async function (assert) {
      assert.expect(2);
      this.server.post('/auth/userpass/users/test', () => {
        assert.true(true, 'POST request made to correct endpoint');
        return;
      });

      const modelType = 'generated-user-userpass';
      await this.pathHelp.getNewModel(modelType, 'userpass', 'auth/userpass/', 'user');
      const model = this.store.createRecord(modelType);
      model.set('mutableId', 'test');
      await model.save();
      assert.strictEqual(model.get('id'), 'test', 'model id is set to mutableId value on save success');
    });

    test('it only generates the model once', async function (assert) {
      assert.expect(2);
      Sinon.spy(this.pathHelp, 'getPaths');

      const modelType = 'generated-user-userpass';
      await this.pathHelp.getNewModel(modelType, 'userpass', 'auth/userpass/', 'user');
      assert.true(this.pathHelp.getPaths.calledOnce, 'getPaths is called for new generated model');

      await this.pathHelp.getNewModel(modelType, 'userpass2', 'auth/userpass/', 'user');
      assert.true(this.pathHelp.getPaths.calledOnce, 'not called again even with different backend path');
    });

    test('it resolves without error if model already exists', async function (assert) {
      Sinon.stub(this.pathHelp, 'getPaths').callsFake(() => {
        assert.notOk(true, 'this method should not be called');
        return reject();
      });
      const modelType = 'cluster';
      await this.pathHelp.getNewModel(modelType, 'my-kv').then(() => {
        assert.true(true, 'getNewModel resolves');
      });
    });
  });

  // These tests verify the runtime shapes match the OpenApiPathItem / PathResolutionResult
  // and OpenApiExpandedProps interfaces introduced when path-help.js was converted to
  // TypeScript (path-help.ts), so the typed contract stays honest as OpenAPI responses change.
  module('getPaths (typed contract)', function (hooks) {
    hooks.beforeEach(function () {
      this.server.get('/auth/userpass/', () => openapiStub);
    });

    test('it resolves a PathResolutionResult whose path entries match the typed Path shape', async function (assert) {
      const pathInfo = await this.pathHelp.getPaths('auth/userpass/', 'userpass');

      assert.strictEqual(
        pathInfo.apiPath,
        'auth/userpass/',
        'apiPath is preserved on the typed PathResolutionResult'
      );
      assert.true(
        Array.isArray(pathInfo.paths),
        'paths is an array as declared on PathResolutionResult/PathInfo'
      );

      const [path] = pathInfo.paths;
      assert.deepEqual(
        Object.keys(path).sort(),
        ['action', 'itemName', 'itemType', 'navigation', 'operations', 'param', 'path'].sort(),
        'each resolved path entry has exactly the fields declared on the Path type backing PathResolutionResult'
      );
      assert.strictEqual(
        path.itemType,
        'user',
        'x-vault-displayAttrs.itemType is surfaced on the typed path entry'
      );
      assert.strictEqual(
        path.action,
        'Create',
        'x-vault-displayAttrs.action is surfaced on the typed path entry'
      );
    });
  });

  module('getProps (typed contract)', function (hooks) {
    hooks.beforeEach(function () {
      this.server.get('/auth/userpass/users/example', () => openapiStub);
    });

    test('it resolves an OpenApiExpandedProps record with typed field metadata', async function (assert) {
      const props = await this.pathHelp.getProps('/v1/auth/userpass/users/example?help=true');

      assert.ok(
        'password' in props,
        'expanded props include the schema-defined field, keyed as declared on OpenApiExpandedProps'
      );
      assert.strictEqual(
        props.password.type,
        'string',
        'schema type is surfaced on the typed ResolvedFieldAttribute-shaped prop'
      );
      assert.true(props.password.sensitive, 'x-vault-displayAttrs.sensitive is surfaced on the typed prop');
      assert.strictEqual(
        props.password.fieldGroup,
        'default',
        'fieldGroup defaults per the OpenApiExpandedProps contract'
      );
    });
  });
});
