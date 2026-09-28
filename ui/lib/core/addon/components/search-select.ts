/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

import Component from '@glimmer/component';
import { service } from '@ember/service';
import { task } from 'ember-concurrency';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { resolve } from 'rsvp';
import { filterOptions, defaultMatcher } from 'ember-power-select/utils/group-utils';
import { removeFromArray } from 'vault/helpers/remove-from-array';
import { addToArray } from 'vault/helpers/add-to-array';
import { assert, debug } from '@ember/debug';

import type ApiService from 'vault/services/api';
import type { ApiErrorResponse } from 'vault/api';

interface SelectOption {
  id: string;
  name?: string;
  searchText?: string;
  new?: boolean;
  isNew?: boolean;
  __isSuggestion__?: boolean;
  __value__?: string;
  groupName?: string;
  options?: SelectOption[];
  [key: string]: unknown;
}

interface SearchSelectArgs {
  onChange: (value: unknown[]) => void;
  onCreate?: (searchTerm: string) => void;
  inputValue?: string[];
  disallowNewItems?: boolean;
  shouldRenderName?: boolean;
  nameKey?: string;
  parentManageSelected?: SelectOption[];
  passObject?: boolean;
  objectKeys?: string[];
  selectLimit?: number;
  models?: string[];
  backend?: string;
  id?: string;
  label?: string;
  labelClass?: string;
  ariaLabel?: string;
  subText?: string;
  fallbackComponent?: string;
  helpText?: string;
  wildcardLabel?: string;
  placeholder?: string;
  displayInherit?: boolean;
  renderTooltip?: (inputValue: string, dropdownOptions: SelectOption[]) => unknown;
  disabled?: boolean;
  options?: SelectOption[];
  search?: (term: string, select: unknown) => unknown;
  searchEnabled?: boolean;
}

/**
 * @module SearchSelect
 * The `SearchSelect` is an implementation of the [ember-power-select](https://github.com/cibernox/ember-power-select) used for form elements where options come dynamically from the API.
 * 
 * @example
 *  <SearchSelect @id="policy" @models={{array "policies/acl"}} @onChange={{this.onChange}} @inputValue={{get @model this.valuePath}} @wildcardLabel="role" @fallbackComponent="string-list" @selectLimit={{1}} @backend={{@model.backend}} @disallowNewItems={{true}} class={{if this.validationError "dropdown-has-error-border"}} />
 *
 // * component functionality
 * @param {function} onChange - The onchange action for this form field. ** SEE EXAMPLE ** mfa-login-enforcement-form.js (onMethodChange) for example when selecting models from a hasMany relationship
 * @param {function} [onCreate] - Callback when user clicks the create new action in the dropdown. Receives the search term as an argument so the parent can determine how to handle creation (ex: open a modal with a form pre-filled with the search term as the name)
 * @param {array} [inputValue] - Array of strings corresponding to the input's initial value, e.g. an array of model ids that on edit will appear as selected items below the input
 * @param {boolean} [disallowNewItems=false] - Controls whether or not the user can add a new item if none found
 * @param {boolean} [shouldRenderName=false] - By default an item's id renders in the dropdown, `true` displays the name with its id in smaller text beside it *NOTE: the boolean flips automatically with 'identity' models or if this.idKey !== 'id'
 * @param {string} [nameKey="name"] - if shouldRenderName=true, you can use this arg to specify which key to use for the rendered name. Defaults to "name".
 * @param {array} [parentManageSelected] - Array of selected items if the parent is keeping track of selections, see mfa-login-enforcement-form.js
 * @param {boolean} [passObject=false] - When true, the onChange callback returns an array of objects with id (string) and isNew (boolean) (and any params from objectKeys). By default - onChange returns an array of id strings.
 * @param {array} [objectKeys] - Array of values that correlate to model attrs. Used to render attr other than 'id' beside the name if shouldRenderName=true. If passObject=true, objectKeys are added to the passed, selected object.
 * @param {number} [selectLimit] - Sets select limit

// * query params for dropdown items
 * @param {Array} models - An array of model types to fetch from the API.
 * @param {string} [backend] - name of the backend if the query for options needs additional information (eg. secret backend)

 // * template only/display args
 * @param {string} id - The name of the form field
 * @param {string} [label] - Label for this form field
 * @param {string} [labelClass] - overwrite default label size (14px) from class="is-label"
 * @param {string} [ariaLabel] - fallback accessible label if label is not provided
 * @param {string} [subText] - Text to be displayed below the label
 * @param {string} fallbackComponent - name of component to be rendered if the API call 403s
 * @param {string} [helpText] - Text to be displayed in the info tooltip for this form field
 * @param {string} [wildcardLabel] - string (singular) for rendering label tag beside a wildcard selection (i.e. 'role*'), for the number of items it includes, e.g. @wildcardLabel="role" -> "includes 4 roles"
 * @param {string} [placeholder] - text you wish to replace the default "search" with
 * @param {boolean} [displayInherit=false] - if you need the search select component to display inherit instead of box.
 * @param {function} [renderTooltip] - receives each inputValue string and list of dropdownOptions as args, so parent can determine when to render a tooltip beside a selectedOption and the tooltip text. see 'oidc/provider-form.js'
 * @param {boolean} [disabled] - if true sets the disabled property on the ember-power-select component and makes it unusable.
 *
 // * advanced customization
 * @param {Array} options - array of objects passed directly to the power-select component. If doing this, `models` should not also be passed as that will overwrite the
 * passed options. ex: [{ name: 'namespace45', id: 'displayedName' }]. It's recommended the parent should manage the array of selected items if manually passing in options.
 * @param {function} search - Customizes how the power-select component searches for matches - see the power-select docs for more information.
 *
 */

export default class SearchSelect extends Component<SearchSelectArgs> {
  @service declare readonly api: ApiService;
  @tracked shouldUseFallback = false;
  @tracked selectedOptions: SelectOption[] = []; // array of selected options (initially set by @inputValue)
  @tracked dropdownOptions: SelectOption[] = []; // options that will render in dropdown, updates as selections are added/discarded
  @tracked allOptions: string[] = []; // both selected and unselected options, used for wildcard filter

  constructor(owner: unknown, args: SearchSelectArgs) {
    super(owner, args);
    assert(
      'one of @id, @label, or @ariaLabel must be passed to search-select component',
      !!(this.args.id || this.args.label || this.args.ariaLabel)
    );
    if (this.args.models) {
      debug(
        'DEVELOPER NOTICE: @models is deprecated as part of the Ember Data migration. Please use @options and pass array of items to render.'
      );
    }
  }

  get hidePowerSelect(): boolean {
    return this.args.selectLimit !== undefined && this.selectedOptions.length >= this.args.selectLimit;
  }

  get idKey(): string {
    // if objectKeys exists, use the first element of the array as the identifier
    // make 'id' as the first element in objectKeys if you do not want to override the default of 'id'
    return this.args.objectKeys ? (this.args.objectKeys[0] as string) : 'id';
  }

  get shouldRenderName(): boolean {
    return this.args.models?.some((model) => model.includes('identity')) ||
      this.idKey !== 'id' ||
      this.args.shouldRenderName
      ? true
      : false;
  }

  get nameKey(): string {
    return this.args.nameKey || 'name';
  }

  get searchEnabled(): boolean {
    if (typeof this.args.searchEnabled === 'boolean') return this.args.searchEnabled;
    return true;
  }

  addSearchText(optionsToFormat: SelectOption[]): SelectOption[] {
    // maps over array of objects or response from query
    return optionsToFormat.map((option) => {
      const id = option[this.idKey] ? option[this.idKey] : option.id;
      option.searchText = `${option[this.nameKey]} ${id}`;
      return option;
    });
  }

  formatInputAndUpdateDropdown(inputValues: string[]): SelectOption[] {
    // inputValues are initially an array of strings from @inputValue
    // map over so selectedOptions are objects
    return inputValues.map((option) => {
      const matchingOption = this.dropdownOptions.find((opt) => opt[this.idKey] === option);
      // tooltip text comes from return of parent function
      const addTooltip = this.args.renderTooltip
        ? this.args.renderTooltip(option, this.dropdownOptions)
        : false;

      // remove any matches from dropdown list
      this.dropdownOptions = removeFromArray(this.dropdownOptions, matchingOption);
      return {
        id: option,
        name: matchingOption ? (matchingOption[this.nameKey] as string) : option,
        searchText: matchingOption ? matchingOption.searchText : option,
        addTooltip,
        // add additional attrs if we're using a dynamic idKey
        ...(this.idKey !== 'id' && this.customizeObject(matchingOption)),
      };
    });
  }

  fetchOptions = task(function* (this: SearchSelect): Generator<unknown, void, unknown> {
    this.dropdownOptions = []; // reset dropdown anytime we re-fetch

    if (this.args.parentManageSelected) {
      // works in tandem with parent passing in @options directly
      this.selectedOptions = this.args.parentManageSelected;
    }

    // this if condition can be removed once model support has been fully deprecated
    // for the remaining usages we will use the api service to maintain fetch functionality
    if (!this.args.models) {
      if (Array.isArray(this.args.options)) {
        const { options } = this.args;
        // if options are nested, let parent handle formatting - see path-filter-config-list.js
        this.dropdownOptions = options.some((e) => Object.keys(e).includes('groupName'))
          ? options
          : [...this.addSearchText(options)];

        // preserve full selected objects when parent manages them, but still remove matches from dropdown
        if (this.args.parentManageSelected) {
          const selectedIds = this.args.parentManageSelected.map((opt) => opt[this.idKey]);
          selectedIds.forEach((id) => {
            const matchingOption = this.dropdownOptions.find((opt) => opt[this.idKey] === id);
            if (matchingOption) {
              this.dropdownOptions = removeFromArray(this.dropdownOptions, matchingOption);
            }
          });
        } else {
          this.selectedOptions = this.args.inputValue
            ? this.formatInputAndUpdateDropdown(this.args.inputValue)
            : [];
        }
      }
      this.shouldUseFallback = !!(
        this.args.fallbackComponent &&
        !this.args.options?.length &&
        this.args.disallowNewItems
      );
      return;
    }

    for (const modelType of this.args.models) {
      try {
        // fetch options from api
        const options = (yield this.fetchWithApiClient(modelType, this.args.backend)) as SelectOption[];

        // store both select + unselected options in tracked property used by wildcard filter
        this.allOptions = [...this.allOptions, ...options.map((option) => option.id)];

        // add to dropdown options
        this.dropdownOptions = [...this.dropdownOptions, ...this.addSearchText(options)];
      } catch (err) {
        const { status, response } = (yield this.api.parseError(err)) as {
          status?: number;
          response?: ApiErrorResponse;
        };
        if (status === 404) {
          // continue to query other models even if one 404s
          // and so selectedOptions will be set after for loop
          continue;
        }
        if (status === 403) {
          this.shouldUseFallback = true;
          return;
        }
        throw response;
      }
    }

    // after all models are queried, set selectedOptions and remove matches from dropdown list
    this.selectedOptions = this.args.inputValue
      ? this.formatInputAndUpdateDropdown(this.args.inputValue)
      : [];
  });

  /**
   * Temporary method to maintain backwards compatibility with original Ember Data model query functionality
   * The @models argument is deprecated and the remaining usages need to be converted to fetch options from the route and pass them via the @options arg
   */
  async fetchWithApiClient(modelType: string, backend?: string): Promise<SelectOption[]> {
    const apiServicePathMap: Record<string, string> = {
      transform: 'secrets.transformListTransformations',
      'transform/alphabet': 'secrets.transformListAlphabets',
      'transform/template': 'secrets.transformListTemplates',
      'transform/role': 'secrets.transformListRoles',
      'database/connection': 'secrets.databaseListConnections',
      'database/role': 'secrets.databaseListRoles',
      'identity/group': 'identity.groupListByName',
      'identity/entity': 'identity.entityListByName',
      'mfa-method': 'sys.systemListMfaMethod',
      'keymgmt/key': 'secrets.keyManagementListKeys',
      'keymgmt/provider': 'secrets.keyManagementListKmsProviders',
      'policy/acl': 'sys.policiesListAclPolicies',
      'policy/rgp': 'sys.systemListPoliciesRgp',
    };
    const apiServicePath = apiServicePathMap[modelType];
    // if model is not recognized in map log error to console, return empty array and use fallback component if it exists
    if (!apiServicePath) {
      debug(
        `DEVELOPER NOTICE: Unrecognized model type "${modelType}" passed to search-select component. Please use @options instead to pass an array of options to render`
      );
      if (this.args.fallbackComponent) {
        this.shouldUseFallback = true;
      }
      return [];
    }
    const args = backend ? [backend, true] : [true];
    const [api, method] = apiServicePath.split('.') as [string, string];
    // this.api[api][method] is fully dynamic (built from the modelType->path
    // map above), so the generated ApiService's strongly typed sub-clients
    // can't be threaded through statically here.
    const apiClient = this.api as unknown as Record<
      string,
      Record<string, (...args: unknown[]) => Promise<{ key_info?: unknown; keys?: string[] }>>
    >;
    const response = await apiClient[api]![method]!(...args);
    if (response.key_info) {
      return this.api.keyInfoToArray<SelectOption>(response);
    }
    return (response.keys ?? []).map((key) => ({ id: key, name: key }));
  }

  @action
  handleChange(): void {
    if (this.selectedOptions.length && typeof this.selectedOptions[0] === 'object') {
      this.args.onChange(
        Array.from(this.selectedOptions, (option) =>
          this.args.passObject ? this.customizeObject(option) : option.id
        )
      );
    } else {
      this.args.onChange(this.selectedOptions);
    }
  }

  shouldShowCreate(id: string, searchResults: SelectOption[]): boolean {
    if (searchResults && searchResults.length && searchResults[0]?.groupName) {
      return !searchResults.some((group) => group.options?.find((opt) => opt.id === id));
    }
    const existingOption =
      this.dropdownOptions && this.dropdownOptions.find((opt) => opt.id === id || opt.name === id);
    if (this.args.disallowNewItems && !existingOption) {
      return false;
    }
    return !existingOption;
  }

  // ----- adapted from ember-power-select-with-create
  addCreateOption(term: string, results: SelectOption[]): void {
    if (this.shouldShowCreate(term, results)) {
      const name = `Click to add new item: ${term}`;
      const suggestion: SelectOption = {
        __isSuggestion__: true,
        __value__: term,
        name,
        id: name,
      };
      results.unshift(suggestion);
    }
  }

  filter(options: SelectOption[], searchText: string): SelectOption[] {
    const matcher = (option: SelectOption, text: string) => defaultMatcher(option.searchText ?? '', text);
    return filterOptions(options || [], searchText, matcher);
  }
  // -----

  customizeObject(option?: SelectOption): SelectOption | undefined {
    if (!option) return;

    let additionalKeys: Record<string, unknown> | undefined;
    if (this.args.objectKeys) {
      // pull attrs corresponding to objectKeys from model record, add to the selection
      additionalKeys = Object.fromEntries(this.args.objectKeys.map((key) => [key, option[key]]));
      // filter any undefined attrs, which could mean the model was not hydrated,
      // the record is new or the model doesn't have that attribute
      Object.keys(additionalKeys).forEach((key) => {
        if (additionalKeys?.[key] === undefined) {
          delete additionalKeys?.[key];
        }
      });
    }
    return {
      id: option.id,
      isNew: !!option.new,
      ...additionalKeys,
    };
  }

  @action
  discardSelection(selected: SelectOption): void {
    this.selectedOptions = removeFromArray(this.selectedOptions, selected);
    if (!selected.new) {
      this.dropdownOptions = addToArray(this.dropdownOptions, selected);
    }
    this.handleChange();
  }

  // ----- adapted from ember-power-select-with-create
  @action
  searchAndSuggest(term: string, select: unknown) {
    if (term.length === 0) {
      return this.dropdownOptions;
    }
    if (this.args.search) {
      return resolve(this.args.search(term, select)).then((results) => {
        this.addCreateOption(term, results as SelectOption[]);
        return results;
      });
    }
    const newOptions = this.filter(this.dropdownOptions, term);
    this.addCreateOption(term, newOptions);
    return newOptions;
  }

  @action
  selectOrCreate(selection: SelectOption): void {
    if (selection && selection.__isSuggestion__) {
      const name = selection.__value__ as string;
      this.selectedOptions = addToArray(this.selectedOptions, { name, id: name, new: true });
      this.args.onCreate?.(name);
    } else {
      this.selectedOptions = addToArray(this.selectedOptions, selection);
      this.dropdownOptions = removeFromArray(this.dropdownOptions, selection);
    }
    this.handleChange();
  }

  // -----
}
