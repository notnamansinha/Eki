import { Bell, MapPin } from "lucide-react";
import styles from "./LiveRoutesHome.module.css";

export default function PassengerLoadingShell() {
  return (
    <div className={styles.home} style={{ height: "100dvh" }} aria-hidden="true">
      <div className={styles.background} />
      <div className={styles.scroll}>
        <div className={styles.content}>
          <div className={styles.header}>
            <span className={styles.location}><MapPin size={19} /> Ahmedabad</span>
            <span className={styles.notification}><Bell size={20} /></span>
          </div>
          <div className={styles.hero}>
            <p className={styles.eyebrow}>YOUR CITY, IN MOTION</p>
            <h1>Live Routes<span className={styles.titleDot}>.</span></h1>
            <p>Restoring your transit session…</p>
          </div>
          <div className={styles.alert}><span className={styles.skeletonBlock} style={{ width: "100%", height: 42 }} /></div>
          <div className={styles.sectionHeading}><h2>Explore routes</h2></div>
          <div className={styles.filters}><span className={styles.skeletonBlock} style={{ width: "100%", height: 48 }} /></div>
          <div className={styles.routeList}>
            <div className={styles.card}><span className={styles.skeletonBlock} style={{ width: "46%", height: 28 }} /><span className={styles.skeletonBlock} style={{ width: "82%", height: 24, marginTop: 30 }} /><span className={styles.skeletonBlock} style={{ width: "62%", height: 16, marginTop: 16 }} /></div>
            <div className={styles.card}><span className={styles.skeletonBlock} style={{ width: "44%", height: 28 }} /><span className={styles.skeletonBlock} style={{ width: "76%", height: 24, marginTop: 30 }} /></div>
          </div>
        </div>
      </div>
      <div className={styles.dockWrap}><div className={styles.dock}><span className={styles.skeletonBlock} style={{ width: "100%", height: 62 }} /></div></div>
    </div>
  );
}
