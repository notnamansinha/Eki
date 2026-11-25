import type { RouteStop } from "@/hooks/useRoutes";

/*
 * Geometry for the demo ride: Thaltej Road, across SG Highway at Thaltej Char
 * Rasta, along Drive-in Road and University Road to Ahmedabad University.
 * Road geometry © OpenStreetMap contributors (ODbL), routed with OSRM; each
 * stop is snapped onto the line. Generated data: do not hand-edit the strings.
 */

export const DEMO_RIDE_STOPS: readonly RouteStop[] = [
  { id: "sbi-thaltej", name: "SBI Branch, Thaltej Road", shortName: "SBI Branch", lat: 23.05049, lng: 72.49886 },
  { id: "thaltej-gam", name: "Thaltej Gam", shortName: "Thaltej Gam", lat: 23.050271, lng: 72.506994 },
  { id: "thaltej-char-rasta", name: "Thaltej Char Rasta", shortName: "Thaltej", lat: 23.049968, lng: 72.517477 },
  { id: "doordarshan-kendra", name: "Doordarshan Kendra", shortName: "Doordarshan", lat: 23.048211, lng: 72.524516 },
  { id: "gurukul-road", name: "Gurukul Road", shortName: "Gurukul Rd", lat: 23.04593, lng: 72.53487 },
  { id: "helmet-circle", name: "Helmet Circle", shortName: "Helmet Circle", lat: 23.045277, lng: 72.54196 },
  { id: "gulbai-tekra", name: "Gulbai Tekra", shortName: "Gulbai Tekra", lat: 23.04292, lng: 72.54879 },
  { id: "ahmedabad-university", name: "Ahmedabad University", shortName: "Ahmedabad Univ.", lat: 23.03891, lng: 72.5525 },
];

/** Encoded (precision 5) road geometry in travel order. */
export const DEMO_RIDE_FORWARD_POLYLINE =
  "q`ukC{|nyLBk@AAAE?C@C@CBAF}@N{D?CN{CJqCH}CLqEDwABu@B[FqAF}@@k@Gq@w@_Ek@gEDc@@mBT{C@WKy@SuATiANe@@CZiABQDs@Bu@@Y?e@Cc@Cg@?K?q@Du@Dw@BaA@c@?e@FsADYPk@FU@MBKGQ@KAa@E}@Cq@IkCMgBAcB@i@TcFDa@Dk@Fk@RgAVeAVcABKd@eBbAcDf@mBDQVwABWBKDOBKDe@@CLmAP}Af@uETkBDWF]Jo@BQLi@BI?AH_@DO\\aA^s@P[lB_Eb@}@Rm@Jc@F[DYHuAD]?O@YDw@FoAHgB@GDu@?GHqC@k@@e@?W?QAW?s@A{A?aCCiD?M?K@mBDiB?uE@sA@kC@uA@iA@_@@U?ELu@Je@FSRg@Z}@`@eBDQJ]F]BIFc@BQd@}Dj@aFDgA@u@D{@Jq@Lk@ZgAJ[^aAb@y@JQBEDEXi@bAgBDGjAsBd@}@HKHBj@JdB\\bALx@Hv@DbABpABT?H@H?\\Av@Cz@?r@CT?@_@?oABcDC}B?MBqC?iBAg@?c@";

/** The same road in reverse; the demo only runs forward, but routes carry both. */
export const DEMO_RIDE_REVERSE_POLYLINE =
  "exrkCclyyL?b@@f@?hBCpC?LB|BCbD?nAA^U?s@B{@?w@B]@I?IAU?qACcACw@Ey@IcAMeB]k@KICIJe@|@kArBEFcAfBYh@EDCDKPc@x@_@`AKZ[fAMj@Kp@Ez@At@EfAk@`Fe@|DCPGb@CHG\\K\\EPa@dB[|@Sf@GRKd@Mt@?DATA^AhAAtAAjCArA?tEEhBAlB?J?LBhD?`C@zA?r@@V?P?VAd@Aj@IpC?FEt@AFIfBGnAEv@AX?NE\\ItAEXGZKb@Sl@c@|@mB~DQZ_@r@]`AENI^?@CHMh@CPKn@G\\EVUjBg@tEQ|AMlAABEd@CJENCJCVWvAEPg@lBcAbDe@dBCJWbAWdASfAGj@Ej@E`@UbFAh@@bBLfBHjCBp@D|@@`@AJFPCJALGTQj@EXGrA?d@Ab@C`AEv@Et@?p@?JBf@Bb@?d@AXCt@Er@CP[hAABOd@UhARtAJx@AVUzCAlBEb@j@fEv@~DFp@Aj@G|@GpACZCt@EvAMpEI|CKpCOzC?BOzDG|@C@ABAB?B@D@@Cj@";

/** Road length in metres. */
export const DEMO_RIDE_LENGTH_M = 6148;
