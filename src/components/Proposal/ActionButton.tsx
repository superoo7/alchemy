import { Address, IDAOState, IProposalStage, IProposalState, IRewardState, Token, IProposalOutcome } from "@daostack/client";
import { executeProposal, redeemProposal } from "actions/arcActions";
import { enableWalletProvider, getArc } from "arc";
import * as classNames from "classnames";
import { ActionTypes, default as PreTransactionModal } from "components/Shared/PreTransactionModal";
import { getCRRewards, getGpRewards, ethErrorHandler, fromWei } from "lib/util";
import Tooltip from "rc-tooltip";
import * as React from "react";
import { connect } from "react-redux";
import { IRootState } from "reducers";
import { showNotification } from "reducers/notifications";
import { IProfileState } from "reducers/profilesReducer";
import withSubscription, { ISubscriptionProps } from "components/Shared/withSubscription";
import { of, combineLatest, Observable } from "rxjs";
import * as css from "./ActionButton.scss";
import RedemptionsTip from "./RedemptionsTip";

import BN = require("bn.js");

interface IExternalProps {
  currentAccountAddress?: Address;
  daoState: IDAOState;
  daoEthBalance: BN;
  detailView?: boolean;
  expanded?: boolean;
  proposalState: IProposalState;
  /**
   * unredeemed GP rewards owed to the current account
   */
  rewards: IRewardState;
  expired: boolean;
}

interface IStateProps {
  beneficiaryProfile: IProfileState;
}

interface IDispatchProps {
  executeProposal: typeof executeProposal;
  redeemProposal: typeof redeemProposal;
  showNotification: typeof showNotification;
}

type IProps = IExternalProps & IStateProps & IDispatchProps & ISubscriptionProps<[BN,BN]>;

const mapStateToProps = (state: IRootState, ownProps: IExternalProps): IExternalProps & IStateProps => {
  const proposalState = ownProps.proposalState;
  return {...ownProps,
    beneficiaryProfile: proposalState.contributionReward ? state.profiles[proposalState.contributionReward.beneficiary] : null,
  };
};

const mapDispatchToProps = {
  redeemProposal,
  executeProposal,
  showNotification,
};

interface IState {
  preRedeemModalOpen: boolean;
}

class ActionButton extends React.Component<IProps, IState> {

  constructor(props: IProps) {
    super(props);
    this.state = {
      preRedeemModalOpen: false,
    };
    this.handleRedeemProposal = this.handleRedeemProposal.bind(this);
  }

  private handleClickExecute = async (): Promise<void> => {
    if (!await enableWalletProvider({ showNotification: this.props.showNotification })) { return; }

    await this.props.executeProposal(this.props.daoState.address, this.props.proposalState.id, this.props.currentAccountAddress);
  }

  private handleClickRedeem = async (): Promise<void> => {

    if (!await enableWalletProvider({ showNotification: this.props.showNotification })) { return; }

    this.setState({ preRedeemModalOpen: true });
  }

  private closePreRedeemModal = (): void => {
    this.setState({ preRedeemModalOpen: false });
  }

  public render(): RenderOutput {
    const {
      beneficiaryProfile,
      currentAccountAddress,
      data,
      daoState,
      daoEthBalance,
      detailView,
      expired,
      expanded,
      proposalState,
      /**
       * unredeemed GP rewards owed to the current account
       */
      rewards,
    } = this.props;

    const daoBalances: {[key: string]: BN} = {
      eth: daoEthBalance,
      externalToken: data && data[0] || new BN(0),
      GEN: data && data[1] || new BN(0),
      nativeToken: undefined,
      rep: undefined,
    };
    /**
     * unredeemed by the current account
     */
    const gpRewards = getGpRewards(rewards);
    const currentAccountNumUnredeemedGpRewards = Object.keys(gpRewards).length;
    /**
     * unredeemed and available to the current account
     */
    const availableGpRewards = getGpRewards(rewards, daoBalances);
    // only true if there are rewards and the DAO can't pay them. false if there are no rewards or they can be paid.
    const daoLacksRequiredGpRewards = Object.keys(availableGpRewards).length < currentAccountNumUnredeemedGpRewards;
    const daoLacksAllRequiredGpRewards = (Object.keys(availableGpRewards).length === 0) && (currentAccountNumUnredeemedGpRewards > 0);
    /**
     * note beneficiary may not be the current account
     */
    let beneficiaryNumUnredeemedCrRewards = 0;
    let daoLacksRequiredCrRewards = false;
    let daoLacksAllRequiredCrRewards = false;
    let contributionRewards;
    if (proposalState.contributionReward) {
      /**
       * unredeemed by the beneficiary
       */
      contributionRewards = getCRRewards(proposalState.contributionReward);
      beneficiaryNumUnredeemedCrRewards = Object.keys(contributionRewards).length;
      /**
       * unredeemed and available to the beneficiary
       */
      const availableCrRewards = getCRRewards(proposalState.contributionReward, daoBalances);
      // only true if there are rewards and the DAO can't pay them. false if there are no rewards or they can be paid.
      daoLacksRequiredCrRewards = Object.keys(availableCrRewards).length < beneficiaryNumUnredeemedCrRewards;
      daoLacksAllRequiredCrRewards = (Object.keys(availableCrRewards).length === 0) && (beneficiaryNumUnredeemedCrRewards > 0);
    }
    // account or beneficiary has a reward
    const hasRewards = (beneficiaryNumUnredeemedCrRewards > 0) || (currentAccountNumUnredeemedGpRewards > 0);

    // true if all rewards can be paid.  doesn't imply there are any rewards
    const canRewardAll = (((beneficiaryNumUnredeemedCrRewards === 0) || !daoLacksRequiredCrRewards) &&
                          ((currentAccountNumUnredeemedGpRewards === 0) || !daoLacksRequiredGpRewards));

    // true if there exist one or more rewards and not any one of them can be paid
    let canRewardNone=false;
    if (daoLacksAllRequiredCrRewards) {
      canRewardNone = daoLacksAllRequiredGpRewards || (currentAccountNumUnredeemedGpRewards === 0);
    } else if (daoLacksAllRequiredGpRewards) {
      canRewardNone = (beneficiaryNumUnredeemedCrRewards === 0);
    }

    const canRewardSomeNotAll = hasRewards && !canRewardAll && !canRewardNone;

    /**
     * Don't show redeem button unless proposal is executed and the current account has GP rewards or
     * some account has CR rewards (either one redeemable or not), where for CR rewards, the winning proposal outcome was Pass.
     * 
     * We'll disable the redeem button if the DAO can't pay any of the redemptions, and warn
     * if it can only pay some of them.
     *
     * We'll display the redeem button even if the CR beneficiary is not the current account.
     */
    const displayRedeemButton = proposalState.executedAt &&
                        ((currentAccountNumUnredeemedGpRewards > 0) ||
                        ((proposalState.winningOutcome === IProposalOutcome.Pass) && (beneficiaryNumUnredeemedCrRewards > 0)));

    const redemptionsTip = RedemptionsTip({
      canRewardNone,
      canRewardOnlySome: canRewardSomeNotAll,
      contributionRewards,
      currentAccountAddress,
      dao: daoState,
      gpRewards,
      id: rewards ? rewards.id : "0",
      proposal: proposalState,
    });

    const redeemButtonClass = classNames({
      [css.redeemButton]: true,
    });

    const wrapperClass = classNames({
      [css.wrapper]: true,
      [css.detailView]: detailView,
      [css.expanded]: expanded,
    });

    return (
      <div className={wrapperClass}>
        {this.state.preRedeemModalOpen ?
          <PreTransactionModal
            actionType={ActionTypes.Redeem}
            action={this.handleRedeemProposal}
            beneficiaryProfile={beneficiaryProfile}
            closeAction={this.closePreRedeemModal}
            dao={daoState}
            effectText={redemptionsTip}
            proposal={proposalState}
            multiLineMsg
          /> : ""
        }

        { proposalState.stage === IProposalStage.Queued && proposalState.upstakeNeededToPreBoost.lt(new BN(0)) ?
          <button className={css.preboostButton} onClick={this.handleClickExecute} data-test-id="buttonBoost">
            <img src="/assets/images/Icon/boost.svg"/>
            { /* space after <span> is there on purpose */ }
            <span> Pre-Boost</span>
          </button> :
          proposalState.stage === IProposalStage.PreBoosted && expired && proposalState.downStakeNeededToQueue.lte(new BN(0)) ?
            <button className={css.unboostButton} onClick={this.handleClickExecute} data-test-id="buttonBoost">
              <img src="/assets/images/Icon/boost.svg"/>
              <span> Un-Boost</span>
            </button> :
            proposalState.stage === IProposalStage.PreBoosted && expired ?
              <button className={css.boostButton} onClick={this.handleClickExecute} data-test-id="buttonBoost">
                <img src="/assets/images/Icon/boost.svg"/>
                <span> Boost</span>
              </button> :
              (proposalState.stage === IProposalStage.Boosted || proposalState.stage === IProposalStage.QuietEndingPeriod) && expired ?
                <button className={css.executeButton} onClick={this.handleClickExecute}>
                  <img src="/assets/images/Icon/execute.svg"/>
                  { /* space after <span> is there on purpose */ }
                  <span> Execute</span>
                </button>
                : displayRedeemButton ?
                  <div>
                    <Tooltip placement="left" trigger={["hover"]} overlay={redemptionsTip}>
                      <button
                        style={{ whiteSpace: "nowrap" }}
                        disabled={canRewardNone}
                        className={redeemButtonClass}
                        onClick={this.handleClickRedeem}
                        data-test-id="button-redeem"
                      >
                        <img src="/assets/images/Icon/redeem.svg" />
                        {
                          (((beneficiaryNumUnredeemedCrRewards > 0) && (currentAccountAddress !== proposalState.contributionReward.beneficiary)) &&
                           (currentAccountNumUnredeemedGpRewards === 0)) ?
                            // note beneficiary can be the current account
                            " Redeem for beneficiary" : " Redeem"
                        }
                      </button>
                    </Tooltip>
                  </div>
                  : ""
        }
      </div>
    );
  }

  private async handleRedeemProposal(): Promise<void> {

    // may not be required, but just in case
    if (!await enableWalletProvider({ showNotification: this.props.showNotification })) { return; }

    const {
      currentAccountAddress,
      daoState,
      proposalState,
      redeemProposal,
    } = this.props;

    await redeemProposal(daoState.address, proposalState.id, currentAccountAddress);
  }
}

const SubscribedActionButton = withSubscription({
  wrappedComponent: ActionButton,
  // Don't ever update the subscription
  checkForUpdate: () => { return false; },
  loadingComponent: null,
  createObservable: (props: IProps) => {
    let externalTokenObservable: Observable<BN>;

    const arc = getArc();
    const genToken = arc.GENToken();

    if (props.proposalState.contributionReward &&
      props.proposalState.contributionReward.externalTokenReward &&
      !props.proposalState.contributionReward.externalTokenReward.isZero()) {

      if (new BN(props.proposalState.contributionReward.externalToken.slice(2), 16).isZero()) {
        // handle an old bug that enabled corrupt proposals
        // eslint-disable-next-line no-console
        console.error(`externalTokenReward is set (to ${fromWei(props.proposalState.contributionReward.externalTokenReward).toString()}) but externalToken address is not`);
        props.proposalState.contributionReward.externalTokenReward = undefined;
        externalTokenObservable = of(undefined);
      } else {
        const token = new Token(props.proposalState.contributionReward.externalToken, arc);
        externalTokenObservable = token.balanceOf(props.daoState.address).pipe(ethErrorHandler());
      }
    } else {
      externalTokenObservable = of(undefined);
    }

    return combineLatest(
      externalTokenObservable,
      genToken.balanceOf(props.daoState.address).pipe(ethErrorHandler())
    );
  },
});

export default connect(mapStateToProps, mapDispatchToProps)(SubscribedActionButton);
