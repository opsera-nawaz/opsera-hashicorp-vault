/**
 * Copyright IBM Corp. 2016, 2025
 * SPDX-License-Identifier: BUSL-1.1
 */

/**
 * @module TtlPicker
 * TtlPicker components are used to enable and select duration values such as TTL.
 * This component renders a toggle by default, and passes all relevant attributes
 * to TtlForm. Please see that component for additional arguments
 * - allows TTL to be enabled or disabled
 * - recalculates the time when the unit is changed by the user (eg 60s -> 1m)
 *
 * @example
 * <TtlPicker @onChange={{this.handleChange}} @initialEnabled={{@model.myAttribute}} @initialValue={{@model.myAttribute}}/>
 *
 * @param {function} onChange - This function will be passed a TTL object, which includes enabled{bool}, seconds{number}, timeString{string}, goSafeTimeString{string}.
 * @param {boolean} initialEnabled=false - Set this value if you want the toggle on when component is mounted
 * @param {string} label=Time to live (TTL) - Label is the main label that lives next to the toggle. Yielded values will replace the label
 * @param {string} labelDisabled=Label to display when TTL is toggled off
 * @param {string} helperTextEnabled - This helper text is shown under the label when the toggle is switched on
 * @param {string} helperTextDisabled - This helper text is shown under the label when the toggle is switched off
 * @param {string} initialValue=null - InitialValue is the duration value which will be shown when the component is loaded. If it can't be parsed, will default to 0.
 * @param {boolean} changeOnInit=false - if true, calls the onChange hook when component is initialized
 * @param {boolean} hideToggle=false - set this value if you'd like to hide the toggle and just leverage the input field
 * @param {boolean} emptyMeansZero=false - treat an empty input as 0 instead of showing a required error, for fields where 0 is meaningful
 */

import Component from '@glimmer/component';
import { typeOf } from '@ember/utils';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Ember from 'ember';
import { restartableTask, timeout } from 'ember-concurrency';
import {
  convertFromSeconds,
  convertToSeconds,
  durationToSeconds,
  goSafeConvertFromSeconds,
  largestUnitFromSeconds,
} from 'core/utils/duration-utils';

interface TtlObject {
  enabled: boolean;
  seconds: number;
  timeString: string;
  goSafeTimeString: string;
}

interface TtlPickerArgs {
  onChange: (ttl: TtlObject) => void;
  initialEnabled?: boolean;
  label?: string;
  labelDisabled?: string;
  helperTextEnabled?: string;
  helperTextDisabled?: string;
  initialValue?: string | number | null;
  changeOnInit?: boolean;
  hideToggle?: boolean;
  emptyMeansZero?: boolean;
}

export default class TtlPickerComponent extends Component<TtlPickerArgs> {
  @tracked enableTTL = false;
  @tracked recalculateSeconds = false;
  @tracked time: string | number = ''; // if defaultValue is NOT set, then do not display a defaultValue.
  @tracked unit = 's';
  @tracked errorMessage = '';

  /* Used internally */
  recalculationTimeout = 5000;
  elementId = 'ttl-' + guidFor(this);

  get label(): string {
    if (this.args.label && this.args.labelDisabled) {
      return this.enableTTL ? this.args.label : this.args.labelDisabled;
    }
    return this.args.label || 'Time to live (TTL)';
  }
  get helperText(): string | undefined {
    return this.enableTTL || this.args.hideToggle
      ? this.args.helperTextEnabled
      : this.args.helperTextDisabled;
  }

  constructor(owner: unknown, args: TtlPickerArgs) {
    super(owner, args);
    const enable = this.args.initialEnabled;

    let setEnable = !!this.args.hideToggle;
    if (!!enable || typeOf(enable) === 'boolean') {
      // This allows non-boolean values passed in to be evaluated for truthiness
      setEnable = !!enable;
    }

    this.enableTTL = setEnable;
    this.initializeTtl();
  }

  initializeTtl(): void {
    const initialValue = this.args.initialValue;

    let seconds = 0;

    if (typeof initialValue === 'number') {
      // if the passed value is a number, assume unit is seconds
      seconds = initialValue;
    } else {
      const parseDuration = durationToSeconds(initialValue ?? '');
      // if parsing fails leave it empty
      if (parseDuration === null) return;
      seconds = parseDuration;
    }

    const unit = largestUnitFromSeconds(seconds);
    this.time = convertFromSeconds(seconds, unit);
    this.unit = unit;

    if (this.args.changeOnInit) {
      this.handleChange();
    }
  }

  get seconds(): number {
    return convertToSeconds(this.time, this.unit);
  }
  get unitOptions() {
    return [
      { label: 'seconds', value: 's' },
      { label: 'minutes', value: 'm' },
      { label: 'hours', value: 'h' },
      { label: 'days', value: 'd' },
    ];
  }

  keepSecondsRecalculate(newUnit: string): void {
    const newTime = convertFromSeconds(this.seconds, newUnit);
    if (Number.isInteger(newTime)) {
      // Only recalculate if time is whole number
      this.time = newTime;
    }
    this.unit = newUnit;
  }

  handleChange(): void {
    const { time, unit, seconds, enableTTL } = this;
    const ttl = {
      enabled: !!(this.args.hideToggle || enableTTL),
      seconds,
      timeString: `${time}${unit}`,
      goSafeTimeString: goSafeConvertFromSeconds(seconds, unit),
    };
    this.args.onChange(ttl);
  }

  @action
  toggleEnabled(): void {
    this.enableTTL = !this.enableTTL;
    this.handleChange();
  }

  // restartableTask()'s standalone (non-decorator) form only accepts async
  // arrow functions, not generator functions (see the mixin/task() usages
  // elsewhere in this story, which use plain `task()`'s TaskFunction overload
  // instead); the arrow function's `this` resolves lexically to this class
  // instance since it's a class field initializer.
  updateTime = restartableTask(async (newTime: string) => {
    this.errorMessage = '';
    const parsedTime = parseInt(newTime, 10);
    if (!newTime) {
      if (this.args.emptyMeansZero) {
        // Leave the input empty but report zero, so clearing the field saves the same value as typing 0.
        this.time = '';
        this.handleChange();
        return;
      }
      this.errorMessage = 'This field is required';
      return;
    } else if (Number.isNaN(parsedTime)) {
      this.errorMessage = 'Value must be a number';
      return;
    }
    this.time = parsedTime;
    this.handleChange();
    if (Ember.testing) {
      return;
    }
    this.recalculateSeconds = true;
    await timeout(this.recalculationTimeout);
    this.recalculateSeconds = false;
  });

  @action
  updateUnit(newUnit: string): void {
    if (this.recalculateSeconds) {
      this.unit = newUnit;
    } else {
      this.keepSecondsRecalculate(newUnit);
    }
    this.handleChange();
  }
}
