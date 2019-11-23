import BN = require("bn.js");
import { IDAOState, IMemberState, Member } from "@daostack/client";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import AccountImage from "components/Account/AccountImage";
import AccountProfileName from "components/Account/AccountProfileName";
import Reputation from "components/Account/Reputation";
import withSubscription, { ISubscriptionProps } from "components/Shared/withSubscription";
import { fromWei } from "lib/util";
import * as React from "react";
import { IProfileState } from "reducers/profilesReducer";
import * as css from "./Dao.scss";

interface IProps extends ISubscriptionProps<IMemberState> {
  dao: IDAOState;
  member: Member;
  daoTotalReputation: BN;
  profile: IProfileState;
}

class DaoMember extends React.Component<IProps, null> {

  public render(): RenderOutput {
    const { dao, daoTotalReputation, profile } = this.props;
    const memberState = this.props.data;

    return (
      <div className={css.member + " clearfix"}
        key={"member_" + memberState.address}
        data-test-id={"member_" + memberState.address}>
        <table className={css.memberTable}>
          <tbody>
            <tr>
              <td className={css.memberAvatar}>
                <AccountImage
                  accountAddress={memberState.address}
                  className="membersPage"
                  profile={profile}
                />
              </td>
              <td className={css.memberName}>
                { profile ?
                  <div>
                    <AccountProfileName accountAddress={memberState.address} accountProfile={profile} daoAvatarAddress={dao.address} />
                    <br/>
                  </div>
                  : <div className={css.noProfile}>No Profile</div>
                }
              </td>
              <td className={css.memberAddress}>
                {memberState.address}
              </td>
              <td className={css.memberReputation}>
                <span className={css.reputationAmount}>{fromWei(memberState.reputation).toLocaleString(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2})}</span>
                <div className={css.reputationAmounts}>
                  (<Reputation daoName={dao.name} totalReputation={daoTotalReputation} reputation={memberState.reputation}/>)
                </div>
              </td>
              <td className={css.memberSocial}>
                {profile && Object.keys(profile.socialURLs).length > 0 ?
                  <span>
                    { profile.socialURLs.twitter ?
                      <a href={"https://twitter.com/" + profile.socialURLs.twitter.username} className={css.socialButton} target="_blank" rel="noopener noreferrer">
                        <FontAwesomeIcon icon={["fab", "twitter"]} className={css.icon} />
                      </a> : ""}
                    { profile.socialURLs.github ?
                      <a href={"https://github.com/" + profile.socialURLs.github.username} className={css.socialButton} target="_blank" rel="noopener noreferrer">
                        <FontAwesomeIcon icon={["fab", "github"]} className={css.icon} />
                      </a> : ""}
                  </span>
                  : ""
                }
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  }
}

export default withSubscription({
  wrappedComponent: DaoMember,
  loadingComponent: <div className={css.loading}>Loading...</div>,
  errorComponent: (props) => <div>{ props.error.message }</div>,
  checkForUpdate: (oldProps, newProps) => { return oldProps.member.id !== newProps.member.id; },
  createObservable: (props: IProps) => props.member.state(),
});
