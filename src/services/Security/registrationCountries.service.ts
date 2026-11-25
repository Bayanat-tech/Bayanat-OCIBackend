import oracledb from 'oracledb';
import isoCountries from 'i18n-iso-countries';
import {getCountries,getCountryCallingCode,parsePhoneNumberFromString,CountryCode} from 'libphonenumber-js';
import {PlatformAdminService as Platform,PlatformError} from './platformAdmin.service';
isoCountries.registerLocale(require('i18n-iso-countries/langs/en.json'));
const phoneCountries=new Set<string>(getCountries());
export type RegistrationCountry={code:string;name:string;iso2:string|null;dialCode:string|null};
export async function registrationCountries(tenant:string):Promise<RegistrationCountry[]> {
  return Platform.scope(tenant,async(c,owner)=>{
    let table='MS_COUNTRY';let columns=await Platform.columns(c,owner,table);
    if(!columns.length){table='MS_COUNTRY_MASTER';columns=await Platform.columns(c,owner,table);}
    if(!columns.some(col=>col.COLUMN_NAME==='COUNTRY_CODE')||!columns.some(col=>col.COLUMN_NAME==='COUNTRY_NAME'))return [];
    const short=columns.some(col=>col.COLUMN_NAME==='SHORT_DESC')?'MIN(SHORT_DESC) SHORT_DESC':"CAST(NULL AS VARCHAR2(5)) SHORT_DESC";
    const result=await c.execute<any>(`SELECT TRIM(COUNTRY_CODE) COUNTRY_CODE,MIN(TRIM(COUNTRY_NAME)) COUNTRY_NAME,${short} FROM ${owner}.${table} WHERE COUNTRY_CODE IS NOT NULL AND COUNTRY_NAME IS NOT NULL GROUP BY TRIM(COUNTRY_CODE) ORDER BY COUNTRY_NAME`,{},{outFormat:oracledb.OUT_FORMAT_OBJECT});
    return (result.rows||[]).map(row=>{
      const code=String(row.COUNTRY_CODE).trim(),name=String(row.COUNTRY_NAME).trim(),upper=code.toUpperCase();
      const candidate=phoneCountries.has(upper)?upper:isoCountries.alpha3ToAlpha2(upper)||isoCountries.getAlpha2Code(name,'en')||String(row.SHORT_DESC||'').toUpperCase();
      const iso2=candidate&&phoneCountries.has(candidate)?candidate as CountryCode:null;
      return {code,name,iso2,dialCode:iso2?'+'+getCountryCallingCode(iso2):null};
    });
  });
}
export function registrationContact(input:any,countries:RegistrationCountry[]) {
  const code=String(input.country||'').trim();
  if(code&&!countries.some(country=>country.code===code))throw new PlatformError('Choose a country from the list');
  const raw=String(input.phone||'').trim();
  if(!raw)return {country:code,phone:''};
  const phoneCountry=String(input.phoneCountry||countries.find(country=>country.code===code)?.iso2||'').toUpperCase();
  if(!countries.some(country=>country.iso2===phoneCountry))throw new PlatformError('Choose a calling country for the contact number');
  const parsed=parsePhoneNumberFromString(raw,phoneCountry as CountryCode);
  if(!parsed?.isValid()||parsed.countryCallingCode!==getCountryCallingCode(phoneCountry as CountryCode))throw new PlatformError('Enter a valid contact number for the selected calling code');
  return {country:code,phone:String(parsed.number)};
}
