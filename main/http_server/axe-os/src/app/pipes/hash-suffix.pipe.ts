import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'hashSuffix'
})
export class HashSuffixPipe implements PipeTransform {

  private static _this = new HashSuffixPipe();

  public static transform(value: number, args?: any): string {
    return this._this.transform(value, args);
  }

  public transform(value: number, args?: any): string {

    const num = Number(value);

    if (num == null || num <= 0 || isNaN(num)) {
      return '0 H/s';
    }

    // Normalize GH/s to H/s
    const normalized = num * 1000000000;

    const suffixes = [' H/s', ' Kh/s', ' Mh/s', ' Gh/s', ' Th/s', ' Ph/s', ' Eh/s'];

    let power = Math.floor(Math.log10(normalized) / 3);
    if (power < 0) {
      power = 0;
    }
    if (power >= suffixes.length) {
      power = suffixes.length - 1;
    }
    const scaledValue = normalized / Math.pow(1000, power);
    const suffix = suffixes[power];

    if (args?.tickmark) {
      return scaledValue.toLocaleString(undefined, { useGrouping: false }) + suffix;
    }

    if (scaledValue < 10) {
      return scaledValue.toFixed(2) + suffix;
    } else if (scaledValue < 100) {
      return scaledValue.toFixed(1) + suffix;
    }

    return scaledValue.toFixed(0) + suffix;
  }
}
